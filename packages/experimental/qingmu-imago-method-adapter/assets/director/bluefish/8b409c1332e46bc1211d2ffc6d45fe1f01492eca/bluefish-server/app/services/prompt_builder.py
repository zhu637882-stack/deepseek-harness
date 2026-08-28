"""
Prompt Builder Service - 风格系统的核心变量组装引擎

负责:
1. 根据项目类型和用户选择,组装所有风格变量
2. 提供变量替换功能,用于 prompt 模板
3. 支持不同粒度的变量组合(单个属性/组合变量)
"""

from typing import Dict, List, Any, Optional
import logging

logger = logging.getLogger("uvicorn.error")


def build_all_variables(project_type_id: str, selections: Dict[str, Any], type_config: Dict[str, Any]) -> Dict[str, str]:
    """
    根据项目类型和用户选择,组装所有变量

    Args:
        project_type_id: 项目类型 ID (如 "movie", "tv-drama")
        selections: 用户的选择 {"realism": "ultra-realistic", "genre_look": ["drama", "romance"], ...}
        type_config: 项目类型配置(从 CONFIG#STYLE_SYSTEM#TYPE#{type_id} 读取)

    Returns:
        所有变量的字典:
        {
            "project_type": "cinematic live-action filmmaking...",
            "realism": "live-action photography, indistinguishable from real-world cinematography...",
            "genre_look": "character-driven drama..., romantic cinematic tone...",
            "style_prompt": "{realism} + {genre_look} + ...",
            "technical_specs": "{frame_ratio} + {resolution}",
            "full_style": "{project_type} + {style_prompt} + {technical_specs}"
        }
    """
    variables = {}

    # 1. 添加系统级变量 {project_type}
    variables["project_type"] = type_config.get("systemPrompt", "")
    logger.info(f"[PromptBuilder] Building variables for type: {project_type_id}")

    # 2. 处理每个属性,生成对应变量
    attributes = type_config.get("attributes", [])
    for attr in attributes:
        attr_id = attr["id"]
        variable_name = attr.get("variableName", attr_id)
        selected_value = selections.get(attr_id)

        if not selected_value:
            # 未选择,跳过
            logger.debug(f"[PromptBuilder] Attribute {attr_id} not selected, skipping")
            continue

        # 组装该属性的 prompt
        prompts = []

        if attr.get("multiple"):
            # 多选: selected_value 是列表
            if not isinstance(selected_value, list):
                selected_value = [selected_value]

            for value in selected_value:
                option_prompt = _find_option_prompt(attr["options"], value)
                if option_prompt:
                    prompts.append(option_prompt)
        else:
            # 单选: selected_value 是字符串
            option_prompt = _find_option_prompt(attr["options"], selected_value)
            if option_prompt:
                prompts.append(option_prompt)

        # 合并为一个变量
        variables[variable_name] = ", ".join(prompts)
        logger.debug(f"[PromptBuilder] Variable {variable_name}: {len(variables[variable_name])} chars")

    # 3. 不再组装组合变量 (已弃用)
    # 现在模板使用显式变量，例如: {realism}, {genre_look}, {color_grading}
    # 而不是组合变量如 {style_prompt}, {scene_style}, {prop_style}
    logger.info(f"[PromptBuilder] Skipping combination variable assembly (using explicit variables in templates)")
    logger.info(f"[PromptBuilder] Total variables built: {len(variables)}")
    return variables


def _find_option_prompt(options: List[Dict], value: str) -> Optional[str]:
    """
    从选项列表中找到对应值的 prompt

    Args:
        options: 选项列表
        value: 选项值

    Returns:
        prompt 字符串,找不到返回 None
    """
    for opt in options:
        if opt.get("value") == value:
            return opt.get("prompt", "")
    return None


def select_template_version(template: Dict[str, Any], project_type: str) -> str:
    """
    根据项目类型选择正确的模板版本

    Args:
        template: 模板配置对象
        project_type: 项目类型 (movie/tv-drama)

    Returns:
        选择的模板内容字符串
    """
    # 如果模板支持多版本
    if template.get("multiVersion"):
        content = template.get("content", {})
        if isinstance(content, dict):
            # 优先使用指定的项目类型，如果不存在则使用 movie 作为默认值
            return content.get(project_type, content.get("movie", ""))

    # 单版本模板，直接返回 content
    return template.get("content", "")


def replace_variables_in_template(template: str, variables: Dict[str, str]) -> str:
    """
    替换模板中的变量占位符

    Args:
        template: 包含占位符的模板,如 "{project_type}, {genre_look}, 主角站在..."
        variables: 变量字典

    Returns:
        替换后的完整字符串

    示例:
        template = "你是分镜师... {project_type} {genre_look} 剧本: {content}"
        variables = {
            "project_type": "cinematic live-action...",
            "genre_look": "character-driven drama...",
            "content": "INT. 卧室..."
        }
        结果: "你是分镜师... cinematic live-action... character-driven drama... 剧本: INT. 卧室..."
    """
    result = template
    replaced_count = 0

    for var_name, var_value in variables.items():
        placeholder = f"{{{var_name}}}"
        if placeholder in result:
            result = result.replace(placeholder, var_value)
            replaced_count += 1
            logger.debug(f"[PromptBuilder] Replaced {{{var_name}}} with {len(var_value)} chars")

    logger.info(f"[PromptBuilder] Replaced {replaced_count} variables in template")
    return result


def get_variable_from_project(project_id: str, variable_name: str) -> str:
    """
    获取某个项目的指定变量值

    Args:
        project_id: 项目ID
        variable_name: 变量名,如 "project_type", "style_prompt", "genre_look"

    Returns:
        变量的 prompt 内容,找不到返回空字符串
    """
    from app.db.repository import get_project_style_settings

    settings = get_project_style_settings(project_id)
    if not settings:
        logger.warning(f"[PromptBuilder] No style settings found for project {project_id}")
        return ""

    variables = settings.get("variables", {})
    value = variables.get(variable_name, "")

    logger.debug(f"[PromptBuilder] Got variable {variable_name} for project {project_id}: {len(value)} chars")
    return value


def build_style_prompt_legacy(style_settings: Optional[Dict[str, Any]]) -> str:
    """
    兼容旧版风格设置的 prompt 构建函数(向后兼容)

    Args:
        style_settings: 旧版风格设置 {"type": "cinematic", "paintingStyle": "...", ...}

    Returns:
        组装的 prompt 字符串

    注意: 这是过渡期函数,仅用于兼容旧数据,未来将废弃
    """
    if not style_settings:
        return ""

    # 如果是新版数据(包含 variables),直接返回 style_prompt
    if "variables" in style_settings:
        return style_settings["variables"].get("style_prompt", "")

    # 旧版数据兼容逻辑
    parts = []

    type_mapping = {
        "cinematic": "cinematic film style, professional cinematography",
        "tv-drama": "television drama production, episodic narrative",
        "documentary": "documentary style, authentic real-world moments",
        "short-film": "short-form narrative, concise storytelling"
    }

    if style_settings.get("type"):
        parts.append(type_mapping.get(style_settings["type"], ""))

    if style_settings.get("paintingStyle"):
        parts.append(style_settings["paintingStyle"])

    if style_settings.get("genre"):
        parts.append(style_settings["genre"])

    if style_settings.get("colorTone"):
        parts.append(style_settings["colorTone"])

    result = ", ".join([p for p in parts if p])
    logger.info(f"[PromptBuilder] Built legacy style prompt: {len(result)} chars")
    return result
