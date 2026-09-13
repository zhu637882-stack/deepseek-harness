# 负面提示词自动生成

根据选择的风格/格式/关系，自动生成该场景专属的负面提示词，不只是通用的。

## 缺陷候选（逐项判断，不自动追加）

青木适配：本表是历史示例，不是筛词器。先区分画面中真实存在的文字、标志、道具、人物与误生成的水印、重复肢体、施工标注。保留剧本指定的文字原文和年代例外；画风、关系或平台名称不能自动禁止场景、色彩、动作或材质。正面设计与候选负面词冲突时，舍弃冲突的负面词，不删改导演设计。

```
no watermark, no logo, no random large text, no garbled Chinese, no broken faces,
no duplicated limbs, no messy panels, no low-quality collage, no text overlay,
no speech bubbles (unless manga format), no cartoon style (unless specified),
no flat illustration, no marketing poster style
```

## 写实人物的候选缺陷词（仅适用于当前设计）

陶瓷、玩偶、动漫、水彩、修饰人像等设计不受下列皮肤模板限制。

```
no airbrushed skin, no beauty filter, no plastic doll skin,
no smooth featureless face, no over-smoothed skin texture,
no digital skin retouching, no perfect porcelain skin
```

## 历史风格候选词（风格名不触发自动追加）

下表刻画的是某些单一风格的示例，不定义该题材能出现什么。古代穿越角色的现代道具、科幻中的自然景观、当代胶片影像、动漫中的写实光影，都按具体剧本与导演设计保留。

| 风格 | 追加负面词 |
|------|-----------|
| 黑金动作 | no bright colors, no pastel tones, no soft lighting, no cartoon violence |
| 科幻机甲 | no natural landscapes, no rural scenes, no vintage elements, no warm tones |
| 东方玄幻 | no modern elements, no technology, no western magic, no mecha, no robots |
| 悬疑惊悚 | no bright light, no vibrant colors, no open spaces, no comedy elements |
| 都市情绪 | no exaggerated effects, no action scenes, no sci-fi elements, no high contrast |
| 青春校园 | no dark themes, no violence, no horror elements, no adult scenes |
| 废土末日 | no vibrant cities, no bright colors, no clean environments, no high technology |
| 宫廷权谋 | no modern elements, no casual clothing, no civilian scenes, no technology |
| 蒸汽朋克 | no electronic components, no digital screens, no modern technology, no minimal design |
| 童话绘本 | no violence, no horror, no darkness, no realistic gore, no sharp angles |
| 二次元动漫 | no realistic lighting, no film grain, no low saturation, no overly realistic |
| 写实摄影 | no exaggerated effects, no over-processing, no CG feel, no studio lighting |
| 复古胶片 | no digital feel, no high definition, no modern elements, no vibrant colors |
| 北欧极简 | no warm tones, no ornate decoration, no tropical elements, no busy scenes |
| 暗黑哥特 | no bright colors, no cheerful themes, no cartoon style, no comedy elements, no modern feel |
| Disney Pixar 3D | no realistic human proportions, no dark horror, no gritty texture |
| Disney 2D | no 3D rendering, no photorealistic, no dark horror, no gritty texture |
| 吉卜力 | no dark horror, no gore, no urban decay, no mechanical elements |
| 好莱坞大片 | no small-scale scenes, no low-budget feel, no comedic elements, no simple compositions |
| Wes Anderson | no asymmetrical composition, no dark horror, no gritty texture, no handheld shake |
| Tim Burton | no bright cheerful, no warm tones, no modern technology, no realistic proportions |
| 王家卫 | no bright uniform light, no symmetrical composition, no clean minimal scenes |
| 张艺谋 | no muted colors, no minimal composition, no low-contrast scenes |
| 韩国犯罪 | no bright colors, no warm tones, no comedic elements, no fantasy elements |
| 中国水墨 | no western oil painting style, no 3D rendering, no photorealistic, no vibrant colors |

## 按格式追加负面词

| 格式 | 追加负面词 |
|------|-----------|
| 全案板 | no single image output, must be multi-panel layout with sections |
| 角色设定卡 | no background elements, no action poses, no scene elements, must be neutral background |
| 场景概念卡 | no character close-ups, no dialogue, no text-heavy layout |
| 海报 | no multi-panel layout, no speech bubbles, no small text details |
| 漫画分镜页 | no photo-realistic panels, no single image, must have panel borders |
| 情绪板 | no character focus, no story panels, must be color/material/atmosphere reference |
| 四格漫画 | must be exactly 4 panels, no more no less, no single image |
| 关键帧序列 | no static poses, must show action progression, no disconnected frames |

## 按关系追加负面词

| 关系 | 追加负面词 |
|------|-----------|
| 宿敌变恋人 | no friendly interaction in early frames, no warm lighting in confrontation |
| 双向暗恋 | no direct eye contact in early frames, no close physical proximity |
| 师徒 | no equal footing in early frames, no casual intimate poses |
| 年上/年下 | no reversed age dynamics, no child-like portrayal of adult |
| 先婚后爱 | no immediate intimacy, no warm lighting in early frames |
| 强制/囚禁 | no free/open environment, no bright cheerful lighting, no voluntary poses |

## 按平台追加负面词

### Midjourney
```
--no text, watermark, logo, signature, blurry, lowres, deformed, disfigured, extra limbs
```

### Stable Diffusion
```
(worst quality, low quality:1.4), (normal quality:1.4), lowres, bad anatomy, bad hands,
extra digits, fewer digits, cropped, jpeg artifacts, signature, watermark, username, blurry
```

## 在 Prompt 中使用

只有明确发现与当前设计相悖的生成倾向时才使用适用项；不拼接所有类别。先核对模型是否支持独立负面参数；不支持时，用清楚的正面表达说明正确外观或修复目标。以下组合不是必填模板：

```
负面提示词：[通用负面词] + [风格追加] + [格式追加] + [关系追加] + [平台追加]
```
