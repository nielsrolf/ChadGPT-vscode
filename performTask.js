let vscode;
let getAdditionalContext, getRepoContext;
// try {
// 	vscode = require('vscode');
// 	({ getAdditionalContext, getRepoContext } = require('./utils.js'));
// } catch (e) {
// 	console.log("Could not load vscode");
// 	({ getAdditionalContext, getRepoContext } = require('./mock_utils.js'));

// }
vscode = require('vscode');
({ getAdditionalContext, getRepoContext } = require('./utils.js'));
const { implementPrompt, responseFormat } = require('./prompts.js');
const { sendChatMessage } = require('./frontend.js');
const { runCommandsInSandbox } = require('./runInSandbox.js');
const { createChatCompletion } = require('./createChatCompletion');




const renderDiffForMessage = (fileDiff) => {
	return `${fileDiff.filename}:${fileDiff.range.start.line}-${fileDiff.range.end.line}}\n\`\`\`before\n${fileDiff.code_before}\n\`\`\`\n\`\`\`after\n${fileDiff.code_after}\n\`\`\`\n`;
}

const formatContextMessage = (context) => {
	return context.map(i => i.message).join('\n');
};


const parseResponseRequiredContext = async (responseMsg, sentContext) => {
	const requiredContextSection = responseMsg
		.replace("# Required context:", "# Required context")
		.split('# Required context')[1]
		.split("# Edits")[0]
		.trim();
	const requiredContextArray = requiredContextSection.split('\n- ')
		.map(x => x.trim()
			.split('\n')[0]
			.trim())
		.map(x => x.startsWith('- ') ? x.split('- ')[1] : x)
		.filter(x => x !== '')
		.filter(x => !sentContext.includes(x));
	const requiredContext = await Promise.all(requiredContextArray.map(getAdditionalContext));
	console.log({ responseMsg, requiredContextSection, requiredContextArray, requiredContext, sentContext });
	return requiredContext;
}


const parseResponseFileDiffs = async (responseMsg) => {
	const fileDiffs = responseMsg
		.replace("# Edits:", "# Edits")
		.split('# Edits')[1]
	const fileDiffsArray = fileDiffs.split('\n- ').filter(x => x !== '').map(x => x.trim());
	const parsedFileDiffs = await Promise.all(fileDiffsArray.map(async x => {
		const [lineRange, ...newLines] = x.split('\n');
		let startLine = 0;
		let endLine = 1000000;
		const filepath = lineRange.split("->")[0].split(":")[0];
		if (lineRange.indexOf(":") !== -1) {
			if (lineRange.split("->")[0].indexOf("-") !== -1) {
				[startLine, endLine] = lineRange.split("->")[0].split(":")[1].split("-");
			} else {
				startLine = lineRange.split("->")[0].split(":")[1];
				endLine = startLine;
			}
		}
		if (newLines.join('\n').indexOf('```') === -1) {
			throw new Error("Could not parse code: expected format: ```<code>```");
		}
		const newCode = newLines.join('\n')
			.replace('```javascript', '```')
			.replace('```js', '```')
			.replace('```python', '```')
			.replace('```py', '```')
			.split('```')
			.slice(1, -1)
			.join('```');

		const document = await vscode.workspace.openTextDocument(filepath);
		const codeBefore = document.getText().split('\n').slice(startLine - 1, endLine).join('\n');
		const message = `- ${filepath}:${startLine}-${endLine}\n\`\`\`before${codeBefore}\`\`\`\n\`\`\`after${newCode}\`\`\``;
		// await sendChatMessage("assistant", `# Edits:\n- ${filepath}:${startLine}-${endLine}\n\`\`\`${newCode}\`\`\``, responseMsgId);
		return {
			filepath, range: {
				start: { line: startLine, character: 0 },
				end: { line: endLine, character: 0 }
			},
			code_after: newCode,
			code_before: codeBefore,
			message: message
		}
	}));
	return parsedFileDiffs;
}

const parseResponseSandboxCommands = async (responseMsg) => {
	const sandboxCommands = responseMsg
		.replace("# Execute:", "# Execute")
		.split('# Execute')[1]
		.replace('```bash', '```')
		.replace('```sh', '```')
		.split('\n```')[1]
		.split('\n');
	const sandboxCommandsWithOutput = await runCommandsInSandbox(sandboxCommands);
	return {sandboxCommands, sandboxCommandsWithOutput};
}


const parseResponse = async (responseMsg, sentContext) => {
	// parse response: get sections for required context and file diffs
	let requiredContext = [];
	let fileDiffs = [];
	let sandboxCommands = [];
	let sandboxCommandsWithOutput = '';
	if (responseMsg.indexOf('# Required context') !== -1) {
		// parse fileDiffs
		requiredContext = await parseResponseRequiredContext(responseMsg, sentContext);
	}
	if (responseMsg.indexOf('# Edits') !== -1) {
		// parse required context
		fileDiffs = await parseResponseFileDiffs(responseMsg);
	}
	if (responseMsg.indexOf('# Execute') !== -1) {
		// parse required context
		console.log("parsing sandbox commands", responseMsg);
		({sandboxCommands, sandboxCommandsWithOutput} = await parseResponseSandboxCommands(responseMsg));
	}
	if (requiredContext.length > 0 || fileDiffs.length > 0 || sandboxCommands.length > 0) {
		let message = "";
		let displayMessage = "";
		if (requiredContext.length > 0) {
			message += `# Required context:\n${requiredContext.map(x => `- ${x.requestMessage}`).join('\n')}\n`;
			displayMessage += `# Required context:\n${requiredContext.map(x => `${x.message}`).join('\n')}\n`;
		} else if (fileDiffs.length > 0) {
			message += `# Edits:\n${fileDiffs.map(x => x.message).join('\n')}\n`;
			displayMessage += `# Edits:\n${fileDiffs.map(x => x.message).join('\n')}\n`;
		} else if (sandboxCommands.length > 0) {
			message += `# Execute:\n\`\`\`bash\n${sandboxCommands}\n\`\`\`\n`;
			displayMessage += `# Execute:\n\`\`\`bash\n${sandboxCommandsWithOutput}\n\`\`\`\n`;
		}
		return { requiredContext, fileDiffs, sandboxCommands, sandboxCommandsWithOutput, message, displayMessage };
	}
	throw new Error("Response must include either '# Required context' or '# Edits' or '# Execute'");
}


const testParseResponseForRequiredContext = async () => {
	const responseMsg = `"My apologies. 

	# Required context
	- /Users/nielswarncke/Documents/ChadGPT-vscode/test/performTask.test.js:1-20
	- /Users/nielswarncke/Documents/ChadGPT-vscode/frontend.js
	- /Users/nielswarncke/Documents/ChadGPT-vscode/performTask.js:98-133"`
	const sentContext = [];
	const parsedResponse = await parseResponse(responseMsg, sentContext);
	console.log({ parsedResponse });
}

// testParseResponseForRequiredContext();


const completeAndParse = async (messages, sentContext, messageId) => {
	const responseMsg = await createChatCompletion(messages);
	const responseMsgId = `${messageId}.${Date.now()}`;
	await sendChatMessage("assistant", responseMsg, responseMsgId);
	console.log({ responseMsg })
	try {
		return await parseResponse(responseMsg, sentContext);
	} catch (e) {
		const errorMsg = `Dear assistant, your response could not be parsed: (${e})\n${responseFormat}`;
		const retryMessages = [...messages, {
			"role": "assistant",
			"content": responseMsg
		}, {
			"role": "system",
			"content": errorMsg
		}];
		// await sendChatMessage("assistant", responseMsg, responseMsgId);
		const errorMsgId = `${responseMsgId}.${Date.now()}`;
		await sendChatMessage("system", errorMsg, errorMsgId);
		const [assistantMsg, response] = await completeAndParse(retryMessages, sentContext, errorMsgId);
		return [assistantMsg, response];
	}
}



const performTask = async (prompt) => {
	// get system prompt from prompts/implement.prompt
	const initialContext = await getRepoContext();
	const sentContext = [];
	const timestamp = new Date().getTime().toString();
	const messages = [
		{
			"role": "system",
			"content": implementPrompt,
			"messageId": timestamp
		},
		{
			"role": "system",
			"content": "An overview of the files that you can ask to see is given below: \n```" + initialContext + "```",
			"messageId": `${timestamp}.1`
		},
		{
			"role": "user",
			"content": prompt,
			"messageId": `${timestamp}.1.2`
		}
	];
	let currentMessageId = `${timestamp}.1.2`;
	for (let message of messages) {
		await sendChatMessage(message.role, message.content, message.messageId);
	}
	while (true) {
		const response = await completeAndParse(messages, sentContext, currentMessageId);
		// to keep the correct order of messages, we need to send the assistant message first
		console.log("parsed response: ", response);
		currentMessageId = `${currentMessageId}.${Date.now()}`;
		await sendChatMessage("system", response.displayMessage, currentMessageId);
		if (response.fileDiffs.length > 0 && response.requiredContext.length === 0) {
			return response.fileDiffs
		} else if (response.requiredContext.length > 0) {
			messages.push({
				"role": "assistant",
				"content": response.message
			});
			messages.push({
				"role": "system",
				"content": formatContextMessage(response.requiredContext)
			});
		} else if (response.sandboxCommands.length > 0) {
			messages.push({
				"role": "assistant",
				"content": response.message
			});
			messages.push({
				"role": "system",
				"content": `\`\`\`\n${response.sandboxCommandsWithOutput}\n\`\`\``
			});
		}
	}
};


module.exports = {
    performTask
}