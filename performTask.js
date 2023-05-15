let vscode;
vscode = require('vscode');
const { sendChatMessage } = require('./frontend.js');
const { runCommandsInSandbox } = require('./runInSandbox.js');
const { createChatCompletion } = require('./createChatCompletion');


const initialPrompt = {
    "task": "Code assistant",
    "system_msg": "You are a helpful coding assistant. You only speak JSON. You help the user implement a feature or debug code in multiple messages. You perform tasks to gather information and then use that information to perform actions. After you have edited a file, you review the new code to check if the edits are correct. When you are done, you perform the 'task completed' action.",
    "response_format": {
        "format": "json",
        "info": "Respond in one of the formats specified in the options. Use actions 'run command' to create or move files, etc. You can take one action per response, and continue to perform actions until the task is done. Respond in pure JSON, with no prose text before or after the JSON, and exactly one JSON object optionally followed by a code block. One exception to the JSON format is that the payload for the 'edit file' action (the new code) are sent directly after the JSON in a ```block```. Do not put JSON after code.",
        "options": [
            // {
            //     "action": "run command",
            //     "command": "<bash command to run - you will see the output in the next message. Examples: 'tree', 'pip install torch', 'mkdir new-dir', 'grep' ...>"
            // },
            // {
            //     "action": "create file",
            //     "path": "<path/to/file>",
            //     "content": "```\n<file content - this does not need JSON string escaping due to the special escaping.>\n```"
            // },
            {
                "action": "edit file",
                "path": "<path/to/file>",
                "start": "<start line>",
                "end": "<end line>",
            },
            {
                "action": "validate edit",
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
                "finalMessage": "<message to show when task is completed>"
            }
        ]
    }
}


const initialUserPrompt = {
    "request": "<insert>",
    "context": null,
}


const performTask = async (task, context) => {
    // context: e.g. {"selection": "code", "currentFile": "path/to/file", "start": 1, "end": 10}
    // currentFile: e.g. 'path/to/file'
    let systemMsg = {...initialPrompt};
    let userMsg = {...initialUserPrompt};
    userMsg.request = task;
    userMsg.context = context;
    return performTasksUntilDone(systemMsg, userMsg);
}


const parseResponse = (responseMsg) => {
    responseMsg = responseMsg.trim().replace('```python', '```')
        .replace('```javascript', '```')
        .replace('```bash', '```')
        .replace('```json', '```')
        .replace('```js', '```')
        .replace('```py', '```')
        .replace('```sh', '```')
        .replace('```ts', '```')
        .replace('```typescript', '```')
        .replace('```html', '```')
        .replace('```css', '```')
        .replace('```scss', '```')
        .replace('```yaml', '```')
        .replace('```yml', '```')
        .replace('```xml', '```')
        .replace('```c', '```')
        .replace('```cpp', '```');

    if(responseMsg.includes('```')) {
        const responseParts = responseMsg.split('```');
        const response = JSON.parse(responseParts[0]);
        // remove the final ``` from the response
        if(responseParts[1].endsWith('```')) {
            responseParts[1] = responseParts[1].substring(0, responseParts[1].length - 3);
        }
        // filter only lines that are in the new range
        const codeLines = responseParts[1].trim().split('\n');
        const newLines = codeLines.map(line => {
            const lineNum = parseInt(line.split(':')[0]);
            if(lineNum >= response.start) 
                // remove line numbers (e.g. '10:') from the response if they exist
                return line.split(': ').slice(1).join(':');
            else
                return null;
        }).filter(line => line !== null);
        response.content = newLines.join('\n');
        return response;
    } else {
        return JSON.parse(responseMsg);
    }
}


const formatAsJsonWithCode = (response) => {
    const content = response.content;
    delete response.content;
    const output = response.output;
    delete response.output;
    const responseString = JSON.stringify(response, null, 2);
    if(!content && !output) return responseString;
    return `${responseString}\n\`\`\`\n${content || ''}${output || ''}\n\`\`\``;
}


const performTasksUntilDone = async (systemMsg, userMsg) => {
    let messages = [
        {
            "role": "system",
            "content": JSON.stringify(systemMsg, null, 2)
        },
        {
            "role": "user",
            "content": JSON.stringify(userMsg, null, 2)
        }
    ];

    let initialAssistant = {
        "action": "show file summary",
        "path": userMsg.context.currentFile
    };
    initialAssistant = {"gptResponse": initialAssistant, "responseRaw": formatAsJsonWithCode(initialAssistant)};
    let currentMsgId = new Date().getTime().toString();
    await sendChatMessage(messages[0].role, messages[0].content, currentMsgId);
    currentMsgId = `${currentMsgId}.${new Date().getTime().toString()}`;
    await sendChatMessage(messages[messages.length - 1].role, messages[messages.length - 1].content, currentMsgId);
    const fileEdits = [];
    while(messages.length < 20) {
        let {gptResponse, responseRaw} = initialAssistant || await askForNextAction(messages);
        initialAssistant = null;
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
            await sortAndApplyFileEdits(fileEdits);
            return gptResponse.finalMessage;
        }
        let userResponse = await executeTask(gptResponse, `${currentMsgId}.stream`);
        console.log('userResponse', userResponse);
        if (userResponse.fileEdit) {
            fileEdits.push({...userResponse.fileEdit});
            delete userResponse.fileEdit;
        }
        if (userResponse.action === 'validate edit') {
            fileEdits[fileEdits.length - 1].validated = true;
        }
        messages.push({
            "role": "user",
            "content": formatAsJsonWithCode(userResponse)
        });
        currentMsgId = `${currentMsgId}.${new Date().getTime().toString()}`;
        await sendChatMessage(messages[messages.length - 1].role, messages[messages.length - 1].content, currentMsgId);
    }
}


const sortAndApplyFileEdits = async (fileEdits) => {
    fileEdits = fileEdits.filter(fileEdit => fileEdit.validated);
    fileEdits = fileEdits.sort((a, b) => {
        if (a.start < b.start) return 1;
        if (a.start > b.start) return -1;
        return 0;
    });
    for(let fileEdit of fileEdits) {
        await applyDiffs(fileEdit);
    }
}


const askForNextAction = async (messages, retry=4) => {
    // send messages to GPT
    // add the surrounding JSON with role: assistant / user etc
    let responseRaw = await createChatCompletion(messages);
    console.log('askForNextAction', responseRaw);
    try {
        let gptResponse = parseResponse(responseRaw);
        console.log('prased', gptResponse);
        return {gptResponse, responseRaw};
    } catch (e) {
        if (retry > 0) {
            console.log('retrying', retry);
            return askForNextAction(messages, retry - 1);
        }
        console.log('error parsing', e);
        return {gptResponse: null, responseRaw};
    }
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


const isIndented = (numberedLine) => {
	const line = numberedLine.split(': ').slice(1).join(': ');
	return line.startsWith(' ') || line.startsWith('\t') || line === '';
};


const getShortContent = async (file) => {
	let fileContents = 'File does not exist';
	try {
		const document = await vscode.workspace.openTextDocument(file);
		fileContents = addLineNumbers(document.getText());
	} catch (e) { }
	// include only lines that are not indented. Note that the line numbers are already added. Insert a line with '...' where the code is removed
	const f = [];
	for (let i = 0; i < fileContents.length; i++) {
		if (isIndented(fileContents[i])) {
			if (f[f.length - 1] !== '...') {
				f.push('...');
			}
		} else {
			f.push(fileContents[i]);
		}
	}
	return f.join('\n');
}


const showFileSummary = async ({path}) => {
    const output = await getShortContent(path);
    console.log('getShortContent', output);
    return {
        "action": "show file summary",
        "path": path,
        "output": output
    }
}


const addLineNumbers = (fileContent) => {
	const lines = fileContent.split('\n');
	const numberedLines = lines.map((line, index) => `${index + 1}: ${line}`);
	return numberedLines;
};


const getSectionContent = async (path, start, end) => {
    const document = await vscode.workspace.openTextDocument(path);
    const lines = addLineNumbers(document.getText());
    const section = lines.slice(parseInt(start) - 1, parseInt(end)).join('\n');
    return section;
}


const viewSection = async ({path, start, end}) => {
    const output = await getSectionContent(path, start, end);
    return {
        "action": "view section",
        "path": path,
        "start": start,
        "end": end,
        "output": output
    }
}


const applyDiffs = async (diff) => {
    console.log('applyDiffs', diff);
    const document = await vscode.workspace.openTextDocument(diff.path);
    const editRange = new vscode.Range(
        new vscode.Position(parseInt(diff.start) - 1, 0),
        new vscode.Position(parseInt(diff.end), 0)
    );
    // remove the line numbers from the code if they exist
    const codeAfter = diff.content.replace(/^[0-9]+: /gm, '');
    const edit = new vscode.TextEdit(editRange, codeAfter + '\n');
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(document.uri, [edit]);
    await vscode.workspace.applyEdit(workspaceEdit);
    await vscode.commands.executeCommand('editor.action.formatDocument', document.uri);
}


const previewEditFile = async ({path, start, end, content}) => {
    const document = await vscode.workspace.openTextDocument(path);
    const lines = document.getText().split('\n');
    const newLines = lines.slice(0, parseInt(start) - 1).concat(content.split('\n')).concat(lines.slice(parseInt(end)));
    const newDocument = newLines.join('\n');
    const newLinesWithNumbers = addLineNumbers(newDocument);
    const startLine = Math.max(parseInt(start - 4), 1);
    const newEnd = start + content.split('\n').length + 4;
    const endLine = Math.min(newEnd, newLinesWithNumbers.length);
	const newContent = newLinesWithNumbers.slice(startLine - 1, endLine).join('\n');
    return {
        "action": "edit file",
        "path": path,
        "start": startLine,
        "end": endLine,
        "content": newContent,
        "fileEdit": {   
            path,
            start,
            end,
            content,
            validated: false
        },
        "info": "This is a preview. Check if the appended new content is correct - in particular, check if the edit specified the correct line range (i.e. the first and last lines of the edit are not duplicated, no line original line is missing). If it looks correct, respond with the 'validate' action. If you want to discard this edit, simply respond with a different action (e.g. a new file edit)."
    }
}


const applyEditFile = async () => {
    return {
        "action": "validate edit",
        "info": "The file edit is saved and will be applied when you finish the task. In future file edits, refer to the lines by their old numbers, as all diffs are applied in the end.",
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
    console.log('executeTask', message);
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
                return await previewEditFile(message);
            case 'validate edit':
                return await applyEditFile(message);
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
        console.log('error', error.message, error.stack);
        return {
            "action": message.action,
            "error": `error while performing action: ${error} - please try again.`,
        }
    }
}


module.exports = {
    performTask
}