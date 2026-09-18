import {createAgent} from './index';

async function test() {
  const threadId = '01899282-c9d9-49c7-96a0-a1ecb17453ea';
  const message = '执行 ls -al';
  const {agent, close} = await createAgent('TestAgent', {
    threadId,
    enableThinking: true,
  });

  function hasThinking(chunk: any) {
    return !!chunk.additional_kwargs.reasoning_content;
  }

  function printThinking(chunk: any) {
    process.stdout.write(chunk.additional_kwargs.reasoning_content);
  }

  function hasContent(chunk: any) {
    return !!chunk.content;
  }

  function printContent(chunk: any) {
    process.stdout.write(chunk.content);
  }

  function hasToolCalls(chunk: any) {
    return chunk.tool_calls && chunk.tool_calls.length > 0;
  }

  function printToolCalls(chunk: any) {
    const toolCalls = chunk.tool_calls;
    for (const toolCall of toolCalls) {
      if (toolCall.name) {
        process.stdout.write(`调用工具: ${toolCall.name}\n`);
        process.stdout.write(`工具参数: ${JSON.stringify(toolCall.args)}\n`);
        process.stdout.write(`工具ID: ${toolCall.id}`);
      }
    }
  }

  function hasToolCallResult(chunk: any) {
    return !!chunk.tool_call_id;
  }

  function isEnd(chunk: any) {
    return !hasThinking(chunk) && !hasContent(chunk) && !hasToolCalls(chunk);
  }

  try {
    const response = await agent.stream(
      {
        messages: [{role: 'user', content: message}],
      },
      {
        streamMode: 'messages',
        configurable: {
          thread_id: threadId,
        },
      },
    );

    let enableThinking = true;
    let stepStart = false;
    let stepEnd = false;
    let currentStep = 0;
    let startThinking = false;
    let hasOutputContentHead = false;

    console.log('-------------------------------------------');
    console.log(message);
    console.log('-------------------------------------------');

    for await (const chunk of response) {
      const [messageChunk, metadata] = chunk;
      const step = metadata.langgraph_step;

      if (step > currentStep) {
        stepStart = true;
        currentStep = step;
        stepEnd = false;
        console.log(`[第${step}步]`);
      }

      if (enableThinking) {
        if (!startThinking && hasThinking(messageChunk)) {
          startThinking = true;
          process.stdout.write('思考过程\n');
        }
        if (hasThinking(messageChunk)) {
          printThinking(messageChunk);
        }
        if (startThinking && !hasThinking(messageChunk)) {
          startThinking = false;
          console.log();
          if (hasContent(messageChunk)) {
            process.stdout.write('\n输出结果\n');
          }
        }
      } else if (!hasOutputContentHead) {
        if (!isEnd(messageChunk)) {
          if (!hasToolCallResult(messageChunk)) {
            process.stdout.write('输出结果\n');
          }
          hasOutputContentHead = true;
        }
      }

      if (hasToolCallResult(messageChunk)) {
        process.stdout.write('工具调用结果\n');
        printContent(messageChunk);
        console.log();
        stepEnd = true;
      } else if (hasContent(messageChunk)) {
        printContent(messageChunk);
      }

      if (hasToolCalls(messageChunk)) {
        process.stdout.write('\n\n调用工具\n');
        printToolCalls(messageChunk);
      }

      if (stepStart && (stepEnd || isEnd(messageChunk))) {
        console.log();
        stepEnd = true;
        hasOutputContentHead = false;
        stepStart = false;
      }
    }

    console.log();
  } finally {
    close();
  }
}

test();
