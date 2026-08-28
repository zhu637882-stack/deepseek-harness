"""
Tests for the prompt template engine — the core of AI generation.
"""
from app.services.prompt_builder import (
    build_all_variables,
    _find_option_prompt,
    select_template_version,
    replace_variables_in_template,
    build_style_prompt_legacy,
)


class TestReplaceVariables:
    def test_basic_replacement(self):
        template = "Hello {name}, welcome to {place}."
        result = replace_variables_in_template(template, {
            "name": "Blue Fish",
            "place": "Blue Fish",
        })
        assert result == "Hello Blue Fish, welcome to Blue Fish."

    def test_missing_variable_left_as_placeholder(self):
        template = "Hello {name}, your role is {role}."
        result = replace_variables_in_template(template, {"name": "Blue Fish"})
        assert "Blue Fish" in result
        assert "{role}" in result

    def test_empty_variables(self):
        template = "No {variables} here."
        result = replace_variables_in_template(template, {})
        assert result == "No {variables} here."

    def test_multiple_occurrences(self):
        template = "{x} and {x} again"
        result = replace_variables_in_template(template, {"x": "hello"})
        assert result == "hello and hello again"


class TestSelectTemplateVersion:
    def test_multi_version_movie(self):
        config = {
            "multiVersion": True,
            "content": {
                "movie": "Movie template: {realism}",
                "tv-drama": "TV template: {series_tone}",
            },
        }
        assert select_template_version(config, "movie") == "Movie template: {realism}"

    def test_multi_version_fallback_to_movie(self):
        config = {
            "multiVersion": True,
            "content": {
                "movie": "fallback template",
            },
        }
        assert select_template_version(config, "unknown-type") == "fallback template"

    def test_single_version(self):
        config = {"content": "Simple template"}
        assert select_template_version(config, "movie") == "Simple template"

    def test_missing_content(self):
        config = {}
        assert select_template_version(config, "movie") == ""


class TestBuildAllVariables:
    def test_single_select(self):
        type_config = {
            "systemPrompt": "cinematic",
            "attributes": [
                {
                    "id": "realism",
                    "variableName": "realism",
                    "multiple": False,
                    "options": [
                        {"value": "ultra-realistic", "prompt": "live-action photography"},
                        {"value": "stylized", "prompt": "stylized artistic look"},
                    ],
                },
            ],
        }
        variables = build_all_variables("movie", {"realism": "ultra-realistic"}, type_config)
        assert variables["project_type"] == "cinematic"
        assert variables["realism"] == "live-action photography"

    def test_multi_select(self):
        type_config = {
            "systemPrompt": "",
            "attributes": [
                {
                    "id": "genre_look",
                    "variableName": "genre_look",
                    "multiple": True,
                    "options": [
                        {"value": "drama", "prompt": "character-driven drama"},
                        {"value": "romance", "prompt": "romantic tone"},
                    ],
                },
            ],
        }
        variables = build_all_variables("movie", {"genre_look": ["drama", "romance"]}, type_config)
        assert "character-driven drama" in variables["genre_look"]
        assert "romantic tone" in variables["genre_look"]

    def test_unselected_attribute_skipped(self):
        type_config = {
            "systemPrompt": "",
            "attributes": [
                {
                    "id": "realism",
                    "variableName": "realism",
                    "options": [{"value": "x", "prompt": "y"}],
                },
            ],
        }
        variables = build_all_variables("movie", {}, type_config)
        assert "realism" not in variables


class TestFindOptionPrompt:
    def test_found(self):
        options = [
            {"value": "a", "prompt": "prompt_a"},
            {"value": "b", "prompt": "prompt_b"},
        ]
        assert _find_option_prompt(options, "b") == "prompt_b"

    def test_not_found(self):
        options = [{"value": "a", "prompt": "prompt_a"}]
        assert _find_option_prompt(options, "z") is None


class TestLegacyStylePrompt:
    def test_new_version_with_variables(self):
        settings = {"variables": {"style_prompt": "cinematic, ultra-realistic"}}
        result = build_style_prompt_legacy(settings)
        assert result == "cinematic, ultra-realistic"

    def test_old_version(self):
        settings = {"type": "cinematic", "paintingStyle": "oil painting"}
        result = build_style_prompt_legacy(settings)
        assert "cinematic" in result.lower() or "cinematography" in result.lower()
        assert "oil painting" in result

    def test_none_settings(self):
        assert build_style_prompt_legacy(None) == ""

    def test_empty_settings(self):
        assert build_style_prompt_legacy({}) == ""
