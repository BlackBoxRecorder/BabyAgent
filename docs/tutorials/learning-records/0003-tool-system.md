# Lesson 3: 工具系统

完成了第 3 课工具系统的学习。理解了 Tool 接口的定义、ToolRegistry 的注册查找机制、以及 bash/fs 工具的具体实现。

**关键收获：**
- Tool 接口 4 要素：name（唯一标识）、description（LLM 看的）、parameters（JSON Schema）、execute（执行函数）
- JSON Schema 格式的参数定义：type、properties、required——与 LLM API 的 tools 参数直接映射
- ToolRegistry：Map 存储 O(1) 查找，防重复注册，提供批量格式转换
- formatToolForLLM() 将内部 Tool 转为 LLMFunctionDef（type: "function" 包装），实现内部模型与外部 API 的解耦
- 策略模式：添加新工具只需实现 Tool 接口 + 注册，ReAct 循环不需要任何修改
- fs 工具族：read/write/edit/ls/grep/find 六个文件操作工具

**对后续学习的影响：** 下一课 MCP 集成中，MCP 工具也是通过 ToolAdapter 转换成标准的 Tool 接口，然后注册到同一个 ToolRegistry 中。
