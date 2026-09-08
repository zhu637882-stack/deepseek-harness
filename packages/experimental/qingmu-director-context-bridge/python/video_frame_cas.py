"""Bind the compiled frame to Writer's existing atomic video task reservation."""
from contextvars import ContextVar
from functools import wraps


class FrameCasTasks:
    def __init__(self, base, store, hash_frame):
        self.base, self.store, self.hash_frame = base, store, hash_frame
        self.expected = ContextVar('qingmu_compiled_video_frame', default=None)

    def __getattr__(self, name):
        return getattr(self.base, name)

    def reserve_generation_job(self, **kwargs):
        expected = self.expected.get()
        if expected is None:
            return self.base.reserve_generation_job(**kwargs)
        frame_id, expected_hash = expected
        if kwargs.get('source_type') != 'StoryboardFrame' or kwargs.get('source_id') != frame_id:
            raise ValueError('video_frame_cas_scope_mismatch')
        original = kwargs.get('atomic_reservation_callback')

        def validate(conn, task_id, request_hash):
            row = conn.execute('SELECT * FROM storyboard_frames WHERE id=?', (frame_id,)).fetchone()
            if row is None:
                raise ValueError('video_frame_missing_before_reservation')
            current = self.store._decode_frame(dict(row))
            if self.hash_frame(current) != expected_hash:
                raise ValueError('video_frame_semantics_changed_before_reservation')
            if original is not None:
                original(conn, task_id, request_hash)

        return self.base.reserve_generation_job(**{**kwargs, 'atomic_reservation_callback': validate})


def install_video_frame_cas(service):
    """Keep the shared service identity and all original take/fee/authority checks.

    Both batch and regenerate already call this single reservation entry. Hash
    the exact compiled input, not a fresh read made after it could have changed.
    A different shot's revision must not invalidate this unchanged frame.
    """
    if isinstance(service.tasks, FrameCasTasks):
        return
    tasks = FrameCasTasks(service.tasks, service.store, service._formal_video_frame_content_sha256)
    original = service._reserve_and_queue_video_job

    @wraps(original)
    def guarded(**kwargs):
        frame = kwargs['frame']
        token = tasks.expected.set((str(frame['id']), tasks.hash_frame(frame)))
        try:
            return original(**kwargs)
        finally:
            tasks.expected.reset(token)

    service.tasks = tasks
    service._reserve_and_queue_video_job = guarded
