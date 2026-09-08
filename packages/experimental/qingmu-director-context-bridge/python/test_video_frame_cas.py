"""Actual TaskCenter reservation races; no provider, worker or formal database."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from jason.domain.store import DramaStore
from jason.domain.task_center import TaskCenter
from jason.apps.studio.video_service import VideoService
from video_frame_cas import install_video_frame_cas


@pytest.fixture
def runtime(tmp_path):
    store = DramaStore(tmp_path / 'video-cas.db')
    project = store.create_project('CAS test', owner='fixture')
    series = store.create_series(project['id'], 'season')
    episode = store.create_episode(project['id'], series['id'], 1, 'episode', 'source')
    frame = store.create_storyboard_frame(project_id=project['id'], episode_id=episode['id'], frame_no=6,
        scene_id=None, title='shot6', duration_sec=5, dialogue={'line': '有人吗？'}, director_plan={},
        visual_atoms={}, image_prompt_cn='车旁', image_prompt_en='car', route_key='b5.first_frame')
    # Run the actual shared reservation implementation, with paid behavior off.
    service = object.__new__(VideoService)
    service.store, service.tasks = store, TaskCenter(store.db_path)
    service.user_credits_enabled = False
    install_video_frame_cas(service)
    def reserve(frame=frame, route='b6.frame_regenerate', key='cas1'):
        return service._reserve_and_queue_video_job(frame=frame,
            payload={'dry_run': True, 'project_id': project['id'], 'episode_id': episode['id']},
            model='fixture-model', task_route_key=route, request_kind='regenerate', requested_idempotency_key=key)
    return store, frame, service, reserve


@pytest.mark.parametrize('route', ['b6.frame_regenerate', 'b6.video_generation'])
def test_patch_between_compilation_and_reservation_rolls_back(runtime, monkeypatch, route):
    store, frame, service, reserve = runtime
    compiled, edited = Event(), Event()
    original = service.tasks.base.reserve_generation_job
    def barrier(**kwargs):
        compiled.set()
        assert edited.wait(5)
        return original(**kwargs)
    monkeypatch.setattr(service.tasks.base, 'reserve_generation_job', barrier)
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(reserve, frame, route)
        assert compiled.wait(5)
        # A separate connection commits a PATCH while the compiled task waits.
        other = DramaStore(store.db_path)
        other.update_storyboard_frame(frame['id'], dialogue={'line': '有人在吗？'})
        edited.set()
        with pytest.raises(ValueError, match='video_frame_semantics_changed_before_reservation'):
            pending.result(timeout=5)
    assert service.tasks.list_tasks_for_project(frame['project_id']) == []


def test_unchanged_semantics_status_patch_and_exact_retry(runtime):
    store, frame, service, reserve = runtime
    store.update_storyboard_frame(frame['id'], status='planned')
    first = reserve()
    repeat = reserve()
    assert first['task']['id'] == repeat['task']['id']
    assert repeat['deduplicated'] is True
    assert first['task']['kernel_status'] == 'DispatchPending'
    assert service.tasks.expected.get() is None


def test_original_reservation_callback_is_preserved_and_atomic(runtime):
    store, frame, service, reserve = runtime
    tasks = service.tasks
    calls = []
    def original_guard(conn, task_id, request_hash):
        calls.append((conn.in_transaction, task_id, request_hash))
        raise ValueError('original-authority-refused')
    token = tasks.expected.set((frame['id'], tasks.hash_frame(frame)))
    try:
        with pytest.raises(ValueError, match='original-authority-refused'):
            tasks.reserve_generation_job(capability='video.visual', route_key='test', provider='fixture',
                model='fixture', payload={}, job_type='VideoGen', source_type='StoryboardFrame', source_id=frame['id'],
                source_revision_id='r1', idempotency_key='guard1', input_snapshot={'exactlyOnceVersion': 2},
                max_attempts=1, atomic_reservation_callback=original_guard)
    finally:
        tasks.expected.reset(token)
    assert len(calls) == 1 and calls[0][0] is True
    assert tasks.list_tasks_for_project(frame['project_id']) == []
