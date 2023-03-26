// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const { Configuration, OpenAIApi } = require("openai");
const path = require('path');
const fs = require('fs');
const { implementPrompt, responseFormat } = require('./prompts.js');
const {runCommandsInSandbox, restartSandbox} = require('./runInSandbox.js');


// interface Range {
// 	start: {
// 		line: number,
// 		character: number
// 	},
// 	end: {
// 		line: number,
// 		character: number
// 	}
// }

// interface FileDiff {
// 	range: Range,
// 	code_before: string,
// 	code_after: string,
// 	filename: string
//  request: string,
//  message: string
// }

// interface RequiredContent {
// 	range: Range,
// 	code_before: string,
// 	filename: string
//  request: string,
//  message: string
// }


const getImplementPrompt = (featureDescription, currentFilePath) => {
	let prefix = "";
	if (currentFilePath) {
		prefix = `In the file ${currentFilePath}:\n`;
	}
	return `${prefix}I want to implement the following feature: ${featureDescription}.`;
};


const getEditPrompt = (selection, featureDescription) => {
	return `In this section:\n${selection}\nI want you to do this: ${featureDescription}`
}


const getDebugPrompt = (command, output) => {
	return `I need your help debugging this command:\n\`\`\`${command}\`\`\`\nCurrently, I get:\n\`\`\`${output}\`\`\`\n`;
}


const addLineNumbers = (fileContent) => {
	const lines = fileContent.split('\n');
	const numberedLines = lines.map((line, index) => `${index + 1}: ${line}`);
	return numberedLines.join('\n');
};


const getOpenAIKey = async () => {
	// If the API key is not set in the environment variable, try to get it from the VSCode workspace configuration
	const openaiApiKey = vscode.workspace.getConfiguration().get('chadgpt.apiKey') || process.env.OPENAI_API_KEY;
	if (openaiApiKey) {
		return openaiApiKey;
	}
	const apiKey = await vscode.window.showInputBox({
		prompt: 'Please enter your OpenAI API key'
	});
	if (apiKey) {
		// Save the API key to the VSCode workspace configuration
		vscode.workspace.getConfiguration().update('chadgpt.apiKey', apiKey, vscode.ConfigurationTarget.Global);
		// Save the API key to the environment variable
		process.env.OPENAI_API_KEY = apiKey;
		return apiKey;
	} else {
		vscode.window.showErrorMessage('Please enter a valid OpenAI API key');
		return;
	}
}


const createChatCompletion = async (messages) => {
	console.log("messages: ", messages);
	if (messages.length > 12) {
		throw new Error("Too many messages");
	}
	const apiKey = await getOpenAIKey();
	const configuration = new Configuration({
		apiKey: apiKey,
	});
	const openai = new OpenAIApi(configuration);
	let responseMsg;
	try {
		const completion = await openai.createChatCompletion({
			model: "gpt-3.5-turbo",
			messages: messages.map(x => {
				return {
					"role": x.role,
					"content": x.content
				}
			})
		});
		responseMsg = completion.data.choices[0].message.content.split("# Explanation")[0].trim();
	} catch (e) {
		console.log(e);
		throw new Error("OpenAI API error");
	}
	return responseMsg;
};


const applyDiffs = async (fileDiffs) => {
	console.log("applying: ", fileDiffs);
	const sortedFileDiffs = fileDiffs.sort((a, b) => b.range.start.line - a.range.start.line);

	for (const diff of sortedFileDiffs) {
		const document = await vscode.workspace.openTextDocument(diff.filepath);
		const editRange = new vscode.Range(
			new vscode.Position(parseInt(diff.range.start.line) - 1, parseInt(diff.range.start.character)),
			new vscode.Position(parseInt(diff.range.end.line), parseInt(diff.range.end.character))
		);
		// remove the line numbers from the code if they exist
		const codeAfter = diff.code_after.replace(/^[0-9]+: /gm, '');
		const edit = new vscode.TextEdit(editRange, codeAfter + '\n');
		const workspaceEdit = new vscode.WorkspaceEdit();
		workspaceEdit.set(document.uri, [edit]);
		await vscode.workspace.applyEdit(workspaceEdit);
		await vscode.commands.executeCommand('editor.action.formatDocument', document.uri);
	}
}



const getContextFiles = async () => {
	const srcFiles = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,py,go,java,rb,php,cs,css,scss,html,json}', '**/node_modules/**');
	const gitignore = await vscode.workspace.findFiles('**/.gitignore');
	const chadIgnore = await vscode.workspace.findFiles('**/.chadignore');
	const chadInclude = await vscode.workspace.findFiles('**/.chadinclude');

	const gitIgnoreLists = await Promise.all(gitignore.map(async (ignoreFile) => {
		const ignoreList = await vscode.workspace.fs.readFile(ignoreFile);
		return ignoreList.toString().split('\n')
			.filter((line) => line.trim() !== '' && !line.startsWith("#"))
			.map((line) => path.relative(vscode.workspace.rootPath, path.join(ignoreFile.path, '..', line)));
	}));

	const chadIgnoreLists = await Promise.all(chadIgnore.map(async (ignoreFile) => {
		const ignoreList = await vscode.workspace.fs.readFile(ignoreFile);
		return ignoreList.toString().split('\n')
			.filter((line) => line.trim() !== '' && !line.startsWith("#"))
			.map((line) => path.relative(vscode.workspace.rootPath, path.join(ignoreFile.path, '..', line)));
	}));

	const chadIncludeLists = await Promise.all(chadInclude.map(async (includeFile) => {
		const includeList = await vscode.workspace.fs.readFile(includeFile);
		return includeList.toString().split('\n')
			.filter((line) => line.trim() !== '' && !line.startsWith("#"))
			.map((line) => path.relative(vscode.workspace.rootPath, path.join(includeFile.path, '..', line)));
	}));

	const gitIg = require('ignore')().add(gitIgnoreLists.flat());
	const chadIg = require('ignore')().add(chadIgnoreLists.flat());
	const chadIn = require('ignore')().add(chadIncludeLists.flat());
	const allowedFiles = srcFiles.filter((file) => {
		const filePathRelative = path.relative(vscode.workspace.rootPath, file.path);
		return chadIn.ignores(filePathRelative) || (!chadIg.ignores(filePathRelative) && !gitIg.ignores(filePathRelative));
	});

	return allowedFiles;
};



const isIndented = (numberedLine) => {
	const line = numberedLine.split(': ').slice(1).join(': ');
	return line.startsWith(' ') || line.startsWith('\t') || line === '';
};


const getShortContent = async (file) => {
	const document = await vscode.workspace.openTextDocument(file);
	const fileContents = addLineNumbers(document.getText()).split('\n');
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
	const message = `- ${file}\n\`\`\`${f.join('\n')}\`\`\``
	return {
		filename: file,
		request: `- ${file}`,
		message: message,
		code_before: f.join('\n'),
		range: {
			start: { line: 0, character: 0 },
			end: { line: document.lineCount, character: 0 }
		}
	};
}


const getRepoContext = async () => {
	const srcFiles = await getContextFiles();
	console.log("srcFiles: ", srcFiles)
	return srcFiles.map(i => i.path).join('\n');
	// const fileContents = await Promise.all(srcFiles.map(getShortContent));
	// // make it a string
	// const fileContentsString = fileContents.map(file => `# file: ${file.filename}\n${file.content}`).join('\n');
	// return fileContentsString;
}


const getAdditionalContext = async (requiredContext) => {
	// returns: # file: <filepath>:<startLine>-<endLine>\n```<code>```
	console.log(requiredContext)
	if (!requiredContext.includes(':')) {
		return await getShortContent(requiredContext);
	}
	const [filepath, lineRange] = requiredContext.split(':');
	let [startLine, endLine] = lineRange.split('-');
	endLine = endLine || startLine;
	const document = await vscode.workspace.openTextDocument(filepath);
	const fileContents = addLineNumbers(document.getText());
	const requiredCode = fileContents.split('\n').slice(startLine - 1, endLine).join('\n');
	const message = `- ${filepath}:${startLine}-${endLine}\n\`\`\`${requiredCode}\`\`\``;
	return {
		filename: filepath,
		request: requiredContext,
		message: message,
		code_before: document.getText().split('\n').slice(startLine - 1, endLine).join('\n'),
		range: {
			start: { line: startLine - 1, character: 0 },
			end: { line: endLine, character: 0 }
		}
	}
};


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


const completeAndParse = async (messages, sentContext, messageId) => {
	const responseMsg = await createChatCompletion(messages);
	const responseMsgId = `${messageId}.${Date.now()}`;
	await sendChatMessage("assistant", responseMsg, responseMsgId);
	console.log({ responseMsg })
	try {
		return await parseResponse(responseMsg, sentContext);
	} catch (e) {
		const errorMsg = `Error: response could not be parsed: (${e})\n${responseFormat}`;
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


async function doesFileExist(uri) {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch (e) {
		return false;
	}
}


async function getAssistantResponse(history) {
	const messages = history.map(x => {
		return {
			"role": x.role,
			"content": x.content ? x.content : x.message
		};
	});
	if (!messages[0] || (messages[0].role !== "system")) {
		messages.unshift({
			"role": "system",
			"content": "You are a helpful coding assistant."
		});
	}
	// directly call the OpenAI API
	const apiKey = await getOpenAIKey();
	const configuration = new Configuration({
		apiKey: apiKey,
	});
	const openai = new OpenAIApi(configuration);
	console.log("sending to openai:", messages);
	const completion = await openai.createChatCompletion({
		model: "gpt-3.5-turbo",
		messages: messages
	});
	console.log(completion.data.choices[0]);
	const responseMsg = completion.data.choices[0].message.content;
	console.log(responseMsg);
	const formattedMsg = responseMsg
		.replace('```javascript', '```')
		.replace('```js', '```')
		.replace('```python', '```')
		.replace('```py', '```')

	return formattedMsg;
}


let panel;
const createPanel = async (context) => {
	// Create a new panel with the chat view
	panel = vscode.window.createWebviewPanel(
		'chadGPTView', // panel ID
		'ChadGPT', // panel title
		vscode.ViewColumn.Beside, // panel location
		{
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(context.extensionPath),
				vscode.Uri.file(path.join(context.extensionPath, 'chadgpt-webview', 'build')),
			],
			canClose: false, // Disable the close button
		}
	);

	// Load the HTML content of the view
	panel.webview.html = getWebviewContent(context.extensionPath, panel);

	// load the messages from the file	
	const loadMessages = async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders[0];
		const messagesUri = workspaceFolder.uri.with({ path: workspaceFolder.uri.path + '/.chadgpt/messages.json' });
		if (await doesFileExist(messagesUri)) {
			const messages = JSON.parse(await vscode.workspace.fs.readFile(messagesUri));
			for (const { role, content, timestamp, messageId } of messages) {
				// Send the message to the web view
				panel.webview.postMessage({
					"role": role,
					"content": content,
					timestamp,
					messageId
				});
			}
		} else {
			console.log('no messages file found');
		}
	};
	await loadMessages();
	// Handle messages received from the view
	panel.webview.onDidReceiveMessage(async (message) => {
		console.log("received message", message);
		// save the message
		await saveMessage(message.role, message.content, message.messageId);
		// send the message to the assistant
		const response = await getAssistantResponse(message.history);
		console.log({ response });
		// send the response to the view
		const timestamp = new Date().getTime();
		const responseId = `${message.messageId}.${timestamp}`
		await saveMessage("assistant", response, responseId);
		console.log("saved")
		panel.webview.postMessage({
			"role": "assistant",
			"content": response,
			timestamp,
			"messageId": responseId
		});
	});
	panel.reveal();
}


function getWebviewContent(extensionPath, panel) {
	const buildPath = path.join(extensionPath, 'chadgpt-webview', 'build');
	const indexPath = path.join(buildPath, 'index.html');
	let html = fs.readFileSync(indexPath, 'utf8');

	// Get the JS and CSS file names dynamically
	const jsFile = fs.readdirSync(path.join(buildPath, 'static', 'js')).find(file => file.startsWith('main.'));
	const cssFile = fs.readdirSync(path.join(buildPath, 'static', 'css')).find(file => file.startsWith('main.'));

	// Replace the script src and css href with the correct vscode-resource URLs
	html = html.replace(
		/src="\/static\/js\/main\..*\.js"/g,
		`src="${panel.webview.asWebviewUri(vscode.Uri.file(path.join(buildPath, 'static', 'js', jsFile)))}"`
	);
	html = html.replace(
		/href="\/static\/css\/main\..*\.css"/g,
		`href="${panel.webview.asWebviewUri(vscode.Uri.file(path.join(buildPath, 'static', 'css', cssFile)))}"`
	);

	// Inject the vscode API
	const vscodeScript = `
		<script>
		window.vscode = acquireVsCodeApi();
		</script>
	`;
	html = html.replace('</body>', `${vscodeScript}</body>`);

	return html;
}


const editSelection = async (context) => {
	const editor = vscode.window.activeTextEditor;
	const selection = editor.selection;
	const featureDescription = await vscode.window.showInputBox({
		prompt: 'What should be done with the selected code?',
		placeHolder: 'e.g. "refactor"'
	});
	if (!featureDescription) {
		return;
	}
	const filepath = editor.document.uri.path;
	const requiredContext = `${filepath}:${selection.start.line + 1}-${selection.end.line + 1}`;
	const selectionContext = await getAdditionalContext(requiredContext);
	const selectedCode = selectionContext.message;
	const prompt = getEditPrompt(selectedCode, featureDescription);
	await createPanel(context);
	const fileDiffs = await performTask(prompt);
	await applyDiffs(fileDiffs);
	vscode.window.showInformationMessage('Selection edited!!');
};


// debug asks for a command to debug, then runs it in the sandbox and sends the output back to chatgpt.
// we need to make a loop similar to performTask, but also parse the `# Shell` section, run the commands, and resond with a `# Output` section
// we ask ChatGPT also if we are done debugging, and if so, we exit the loop
async function debugCommand(context) {
	// TODO
	// step 1: ask for a command to debug
	const commandPrompt = await vscode.window.showInputBox({
		prompt: 'What command would you like to debug?',
		placeHolder: 'e.g. "pytest test'
	});
	if (!commandPrompt) {
		return;
	}
	// step 2: run the command in the sandbox
	const commandOutput = await runCommandsInSandbox([commandPrompt]);
	// step 3: construct a prompt for implementFeature
	const prompt = getDebugPrompt(commandPrompt, commandOutput);
	// step 4: init the webview
	await createPanel(context);
	// step 5: call performTask
	await performTask(prompt);
}


const renderDiffForMessage = (fileDiff) => {
	return `${fileDiff.filename}:${fileDiff.range.start.line}-${fileDiff.range.end.line}}\n\`\`\`before\n${fileDiff.code_before}\n\`\`\`\n\`\`\`after\n${fileDiff.code_after}\n\`\`\`\n`;
}

const implementFeature = async (context) => {
	const editor = vscode.window.activeTextEditor;
	// The code you place here will be executed every time your command is executed
	// Display a message box to the user
	// const selection = editor?.selection;
	const featureDescription = await vscode.window.showInputBox({
		prompt: 'Enter a feature description',
		placeHolder: 'e.g. "add a menu bar to the top of the page using a new component"'
	});
	console.log("feature description: ", featureDescription);
	if (!featureDescription) {
		return;
	}
	let currentFilePath;
	try {
		currentFilePath = editor.document.uri.path;
	} catch (e) {
		console.log(e);
	}
	const prompt = getImplementPrompt(featureDescription, currentFilePath);
	console.log("prompt: ", prompt);
	await createPanel(context);
	console.log("created panel");
	const fileDiffs = await performTask(prompt);
	console.log("file diffs: ", fileDiffs)
	await applyDiffs(fileDiffs);
	// todo: sanity check that the file diffs are what chadgpt wanted
	const validatePrompt = `You were just tasked to do the following: ${featureDescription}.You proposed the following changes: ${fileDiffs.map(renderDiffForMessage)}. Are these changes correct? If yes, answer with 'yes' - otherwise suggest a new edit.`;
	vscode.window.showInformationMessage('Feature implemented!');
}


async function saveMessage(role, content, messageId = Date.now().toString()) {
	const chadGptDirUri = vscode.Uri.file(path.join(vscode.workspace.rootPath, '.chadgpt'));
	const messagesFileUri = vscode.Uri.joinPath(chadGptDirUri, 'messages.json');
	const messageObj = { role, content, messageId };
	try {
		await vscode.workspace.fs.createDirectory(chadGptDirUri);
	} catch (error) {
		console.log(error, error.code);
		if (error.code !== 'FileExists') {
			throw error;
		}
	}
	try {
		const messagesContent = await vscode.workspace.fs.readFile(messagesFileUri);
		const messages = JSON.parse(messagesContent.toString());
		messages.push(messageObj);
		await vscode.workspace.fs.writeFile(messagesFileUri, Buffer.from(JSON.stringify(messages, null, 2)));
	} catch (error) {
		if (error.code === 'FileNotFound') {
			await vscode.workspace.fs.writeFile(messagesFileUri, Buffer.from(JSON.stringify([messageObj], null, 2)));
		} else {
			console.log("wtf");
			console.log(error.code);
			console.log(error);
			console.log(role, content);
			console.log("message not saved", error);
		}
	}
}


async function sendChatMessage(role, content, messageId) {
	// Send the message to the web view
	const messageObj = { "role": role, "content": content, "messageId": messageId };
	console.log('sending message', messageObj)
	// Send the message to the web view
	panel.webview.postMessage(messageObj);
	console.log('message sent, saving');
	await saveMessage(role, content, messageId);
}


function activate(context) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(
		vscode.commands.registerCommand('chadgpt.implementFeature', async () => await implementFeature(context))
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('chadgpt.showChadGPT', async () => await createPanel(context))
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('chadgpt.editSelection', async () => await editSelection(context))
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('chadgpt.debug', async () => await debugCommand(context))
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('chadgpt.restartSandbox', async () => await restartSandbox())
	);
}


// This method is called when your extension is deactivated
function deactivate() { }

module.exports = {
	activate,
	deactivate
}
