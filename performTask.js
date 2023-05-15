let vscode;
vscode = require('vscode');
({ getShortContent } = require('./utils.js'));
const { sendChatMessage } = require('./frontend.js');
const { runCommandsInSandbox } = require('./runInSandbox.js');
const { createChatCompletion } = require('./createChatCompletion');


const initialPrompt = {
    "task": "Code assistant",
    "system_msg": "You are a helpful coding assistant. You help the user implement a feature or debug code in multiple messages. You perform tasks to gather information and then use that information to perform actions. After you have edited a file, you view it to check if the edits are correct. When you are done, you perform the 'task completed' action.",
    "user_task": "<insert>",
    "context": null,
    "response_format": {
        "format": "json",
        "info": "Respond in one of the formats specified in the options. Use actions 'run command' to create or move files, etc. You can take one action per response, and continue to perform actions until the task is done. Respond in pure JSON, with no prose text before or after the JSON, as it will mess up the automated parsing of your response.",
        "options": [
            {
                "action": "run command",
                "command": "<bash command to run - you will see the output in the next message. Examples: 'tree', 'pip install torch', 'mkdir new-dir', 'grep' ...>"
            },
            {
                "action": "create file",
                "path": "<path/to/file>",
                "content": "```\n<file content - this does not need JSON string escaping due to the special escaping.>\n```"
            },
            {
                "action": "edit file",
                "path": "<path/to/file>",
                "start": "<start line>",
                "end": "<end line>",
                "content": "```\n<content that replaces the current selection - this does not need JSON string escaping due to the special escaping.>\n```"
            },
            {
                "action": "show file summary",
                "path": "<path/to/file>"
            },
            {
                "action": "view section",
                "path": "<path/to/file>",
                "start": "<start line>",
                "end": "<end line>"
            },
            // {
            //     "action": "search folder",
            //     "search_term": "<search term>",
            //     "include_regex": "<regex to include files, optional>",
            //     "exclude_regex": "<regex to exclude files, optional>"
            // },
            {
                "action": "task completed",
                "final_message": "<message to show when task is completed>"
            }
        ]
    }
}


const parseResponse = async (responseMsg) => {
    // JSON escape the unescaped code blocks between 'content": "```' and '```'
    if( !responseMsg.includes('"content": "```') ) {
        return JSON.parse(responseMsg);
    }
    let codeEscaped = JSON.stringify(responseMsg.split('"content": "```')[1].split('\n```"')[0]);
    let responseEscaped = responseMsg.split('"content": "```')[0] + '"content": "' + codeEscaped + '"' + responseMsg.split('\n```"')[1];
    let response = JSON.parse(responseEscaped);
    return response;
}


const performTask = async (task, context) => {
    // context: e.g. {"selection": "code", "currentFile": "path/to/file", "start": 1, "end": 10}
    // currentFile: e.g. 'path/to/file'
    let initialMessage = {...initialPrompt};
    initialMessage.context = context;
    initialMessage.user_task = task;
    return performTasksUntilDone(initialMessage);
}


const performTasksUntilDone = async (message) => {
    let messages = [
        {
            "role": "system",
            "content": JSON.stringify(message, null, 2)
        }
    ];
    let currentMsgId = new Date().getTime().toString();
    await sendChatMessage(messages[0].role, messages[0].content, currentMsgId);
    while(true) {
        let {gptResponse, responseRaw} = await askForNextAction(messages);
        console.log('gptResponse', gptResponse, responseRaw);
        messages.push(
            {
                "role": "assistant",
                "content": responseRaw
            }
        );
        currentMsgId = `${currentMsgId}.${new Date().getTime().toString()}`;
        await sendChatMessage(messages[messages.length - 1].role, messages[messages.length - 1].content, currentMsgId);
        // await sendChatMessage(JSON.stringify(gptResponse, null, 2), currentMsgId);
        if (gptResponse.action === 'task completed') {
            return gptResponse.final_message;
        }
        let userResponse = await executeTask(gptResponse, `${currentMsgId}.stream`);
        messages.push({
            "role": "user",
            "content": JSON.stringify(userResponse)
        });
        currentMsgId = `${currentMsgId}.${new Date().getTime().toString()}`;
        await sendChatMessage(messages[messages.length - 1].role, messages[messages.length - 1].content, currentMsgId);
    }
}


const askForNextAction = async (messages) => {
    // send messages to GPT
    // add the surrounding JSON with role: assistant / user etc
    let responseRaw = await createChatCompletion(messages);
    console.log('askForNextAction', responseRaw);
    // let parsedResponse = parseResponse(responseRaw);
    let gptResponse = {'action': 'task completed', 'final_message': 'test'};
    return {gptResponse, responseRaw};
}


// tasks
const runCommand = async ({command}, streamId) => {
    let output = await runCommandsInSandbox(command, streamId);
    return {
        "action": "run command",
        "command": command,
        "output": output
    }
}


const createFile = async ({path, content}) => {
    let output = await runCommandsInSandbox(`echo "${content}" > ${path}`);
    return {
        "action": "create file",
        "path": path,
        "output": 'ok'
    }
}


const showFileSummary = async ({path}) => {
    const output = getShortContent(path);
    return {
        "action": "show file summary",
        "path": path,
        "output": output
    }
}


const viewSection = async ({path, start, end}) => {
    let output = await runCommandsInSandbox(`cat ${path} | head -n ${end} | tail -n ${end-start}`);
    return {
        "action": "view section",
        "path": path,
        "start": start,
        "end": end,
        "output": output
    }
}

const applyDiffs = async (diff) => {
    const document = await vscode.workspace.openTextDocument(diff.path);
    const editRange = new vscode.Range(
        new vscode.Position(parseInt(diff.start) - 1, 0),
        new vscode.Position(parseInt(diff.end), 0)
    );
    // remove the line numbers from the code if they exist
    const codeAfter = diff.code_after.replace(/^[0-9]+: /gm, '');
    const edit = new vscode.TextEdit(editRange, codeAfter + '\n');
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(document.uri, [edit]);
    await vscode.workspace.applyEdit(workspaceEdit);
    await vscode.commands.executeCommand('editor.action.formatDocument', document.uri);
}


const editFile = async ({path, start, end, content}) => {
    // TODO apply the edits to the file and return a new selection
    await applyDiffs({
        "path": path,
        "start": start,
        "end": end,
        "content": content
    })
    const document = await vscode.workspace.openTextDocument(path);
    const startLine = Math.max(parseInt(start - 4), 1);
    const endLine = Math.min(parseInt(end + 4), document.lineCount);
	const newContent = document.getText().split('\n').slice(startLine, endLine).join('\n');
    return {
        "action": "edit file",
        "path": path,
        "start": start,
        "end": end,
        "new_content": {
            "start": startLine,
            "end": endLine,
            "content": newContent
        }
    }
}


// const searchFolder = async ({searchTerm, includeRegex, excludeRegex}) => {
//     // TODO only search those files that match the includeRegex and don't match the excludeRegex
//     let output = 
//     return {
//         "action": "search folder",
//         "search_term": searchTerm,
//         "include_regex": includeRegex,
//         "exclude_regex": excludeRegex,
//         "output": output
//     }
// }


const executeTask = async (message, streamId) => {
    try {
        switch(message.action) {
            case 'run command':
                return await runCommand(message, streamId);
            case 'create file':
                return await createFile(message);
            case 'show file summary':
                return await showFileSummary(message);
            case 'view section':
                return await viewSection(message);
            case 'edit file':
                return await editFile(message);
            // case 'search folder':
            //     return await searchFolder(message);
            case 'task completed':
                return message;
            default:
                // retry
                return {
                    "error": "unknown action",
                }
        }
    } catch (error) {
        return {
            "error": `error while performing action: ${error} - please try again.`,
        }
    }
}


module.exports = {
    performTask
}