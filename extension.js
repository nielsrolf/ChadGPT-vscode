// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const { Configuration, OpenAIApi } = require("openai");
const path = require('path');
const fs = require('fs');
const { implementPrompt } = require('./prompts.js');


const getImplementPrompt = (featureDescription, currentFilePath) => {
	return `In this file ${currentFilePath}, I want to implement the following feature: ${featureDescription}.`;
};


const getEditPrompt = (selection, featureDescription) => {
	return `In this section:\n ${selection}\nI you to do this: ${featureDescription}`
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

const applyDiffs = async (fileDiffs) => {
	const sortedFileDiffs = fileDiffs.sort((a, b) => {
		if (a.range.start.line < b.range.start.line) {
			return 1;
		}
		if (a.range.start.line > b.range.start.line) {
			return -1;
		}
		return 0;
	});
	for (const diff of sortedFileDiffs) {
		const document = await vscode.workspace.openTextDocument(diff.filepath);
		const editRange = new vscode.Range(
			new vscode.Position(parseInt(diff.range.start.line) - 1, parseInt(diff.range.start.character)),
			new vscode.Position(parseInt(diff.range.end.line), parseInt(diff.range.end.character))
		);
		const edit = new vscode.TextEdit(editRange, diff.code_after + '\n');
		const workspaceEdit = new vscode.WorkspaceEdit();
		workspaceEdit.set(document.uri, [edit]);
		await vscode.workspace.applyEdit(workspaceEdit);
	}
};


const getContextFiles = async () => {
	// get all text files in the workspace
	const srcFiles = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,py,go,java,rb,php,cs,css,scss,html,md,txt,json}', '**/node_modules/**');
	const gitignore = await vscode.workspace.findFiles('**/.gitignore');
	const chadIgnore = await vscode.workspace.findFiles('**/.chadignore');
	const chadInclude = await vscode.workspace.findFiles('**/.chadinclude');
	console.log("1", chadInclude);
	const gitIgnoreLists = await Promise.all(gitignore.map(async (ignoreFile) => {
		const ignoreList = await vscode.workspace.fs.readFile(ignoreFile);
		return ignoreList.toString().split('\n').map((line) => `${ignoreFile.path}/${line}`).join('\n');
	}));
	console.log("2", gitIgnoreLists)
	const chadIgnoreLists = await Promise.all(chadIgnore.map(async (ignoreFile) => {
		const ignoreList = await vscode.workspace.fs.readFile(ignoreFile);
		return ignoreList.toString().split('\n').map((line) => `${ignoreFile.path}/${line}`).join('\n');
	}));
	const chadIncludeLists = await Promise.all(chadInclude.map(async (includeFile) => {
		const includeList = await vscode.workspace.fs.readFile(includeFile);
		return includeList.toString().split('\n').map((line) => `${includeFile.path}/${line}`).join('\n');
	}));
	
	const gitIg = require('ignore')().add(gitIgnoreLists.join('\n'));
	console.log("gitIg", gitIg);
	const chadIg = require('ignore')().add(chadIgnoreLists.join('\n'));
	console.log("chadIg", chadIg);
	const chadIn = require('ignore')().add(chadIncludeLists.join('\n'));
	
	const allowedFiles = srcFiles.filter((file) => {
		console.log("testing file", file)
		// avoid: path should be a `path.relative()`d string, but got "/Users/nielswarncke/Documents/chadgpt/extension.js"
		const filePathRelative = path.relative(vscode.workspace.rootPath, file.path);
		if (chadIg.ignores(filePathRelative)) {
			return false;
		}
		if (chadIn.ignores(filePathRelative)) {
			return true;
		}
		return !gitIg.ignores(filePathRelative);
		// now add chadinclude files, then remove chadignore files
	})
	console.log("allowedFiles", allowedFiles);
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
	for(let i = 0; i < fileContents.length; i++) {
		if (isIndented(fileContents[i])) {
			if (f[f.length - 1] !== '...'){
				f.push('...');
			}
		} else {
			f.push(fileContents[i]);
		}
	}
	return {filename: file.path, content: f.join('\n')};
}


const getRepoContext = async () => {
	const srcFiles = await getContextFiles();
	const fileContents = await Promise.all(srcFiles.map(getShortContent));
	// make it a string
	const fileContentsString = fileContents.map(file => `# file: ${file.filename}\n${file.content}`).join('\n');
	return fileContentsString;
}


const getAdditionalContext = async (additionalContext) => {
	const contextParts = await Promise.all(additionalContext.map(async (requiredContext) => {
		const [filepath, lineRange] = requiredContext.split(':');
		const [startLine, endLine] = lineRange.split('-');
		const document = await vscode.workspace.openTextDocument(filepath);
		const fileContents = addLineNumbers(document.getText());
		const requiredCode = fileContents.split('\n').slice(startLine - 1, endLine).join('\n');
		return `# file: ${filepath}:${startLine}-${endLine}\n${requiredCode}`;
	}));
	const context = contextParts.join('\n');
	return context;
};


const performTask = async (prompt, featureDescription) => {
	// get system prompt from prompts/implement.prompt
	const initialContext = await getRepoContext();
	const sentContext = [];
	const messages = [
		{
			"role": "system",
			"content": implementPrompt
		},
		{
			"role": "system",
			"content": "An overview of the file structure of the project is shown below. \n<pre><code>" + initialContext + "</code></pre>"
		},
		{
			"role": "user",
			"content": prompt
		}
	];
	for(let message of messages) {
		await sendChatMessage(message.role, message.content);
	}
	while(true) {
		const [assistantMsg, response] = await completeAndParse(messages, sentContext);
		if (response.fileDiffs.length > 0) {
			return response.fileDiffs
		} else {
			messages.push({
				"role": "assistant",
				"content": assistantMsg
			});
			const additionalContext = response.requiredAdditionalContext;
			sentContext.push(...additionalContext);
			const context = await getAdditionalContext(additionalContext);
			messages.push({
				"role": "system",
				"content": "```" + context + "```"
			});
			await sendChatMessage("system", "<pre><code>" + context + "</code></pre>");
		}
	}
};


const completeAndParse = async (messages, sentContext) => {
	if (messages.length > 10) {
		throw new Error("Too many messages");
	}
	const apiKey = await getOpenAIKey();
	const configuration = new Configuration({
		apiKey: apiKey,
	});
	const openai = new OpenAIApi(configuration);
	const completion = await openai.createChatCompletion({
		model: "gpt-3.5-turbo",
		messages: messages
	});
	const responseMsg = completion.data.choices[0].message.content.split("# Explanation")[0].trim();
	
	try {
		// parse response: get sections for required context and file diffs
		if(responseMsg.indexOf('# Required context') !== -1) {
			// parse fileDiffs
			const requiredContext = responseMsg
			.replace("# Required context:", "# Required context")
			.split('# Required context')[1]
			.split("# Edits")[0]
			.trim();
			const requiredContextArray = requiredContext.split('\n- ')
			.map(x => x.trim()
			.split('\n')[0]
			.trim())
			.map(x => x.startsWith('- ') ? x.split('- ')[1] : x)
			.filter(x => x !== '')
			.filter(x => !sentContext.includes(x));
			if(requiredContextArray.length > 0)	{
				await sendChatMessage("assistant", `# Required context:\n- ${requiredContextArray.join('\n- ')}`);
				return [responseMsg, {
					requiredAdditionalContext: requiredContextArray,
					fileDiffs: []
				}];
			}		
		}
		if(responseMsg.indexOf('# Edits') !== -1) {
			// parse required context
			const fileDiffs = responseMsg
			.replace("# Edits:", "# Edits")
			.split('# Edits')[1]
			const fileDiffsArray = fileDiffs.split('\n- ').filter(x => x !== '').map(x => x.trim());
			const parsedFileDiffs = await Promise.all(fileDiffsArray.map(async x => {
				const [lineRange, ...newLines] = x.split('\n');
				if((lineRange.indexOf(":") === -1) || (lineRange.split("->")[0].indexOf("-") === -1)) {
					throw new Error("Could not parse line range: expected format: <filepath>:<startLine>-<endLine>");
				}
				if(newLines.join('\n').indexOf('```') === -1) {
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
				
				const [filepath, fromTo] = lineRange.split(':');
				const [startLine, endLine] = fromTo.split(' -> ')[0].split('-');
				await sendChatMessage("assistant", `# Edits:\n- ${filepath}:${startLine}-${endLine}\n<pre><code>\n${newCode}\n</code></pre>`);
				return {filepath, range: {
					start: {line: startLine, character: 0},
					end: {line: endLine, character: 0}
				}, code_after: newCode};
			}));
			return [responseMsg, {
				requiredAdditionalContext: [],
				fileDiffs: parsedFileDiffs
			}];
		}
		throw new Error("Response must include either '# Required context' or '# Edits'");
	} catch (e) {
		const errorMsg = `Error: response could not be parsed. Please respond in the provided format, with sections '# Required context' and '# Edits'. (${e})`;
		const retryMessages = [...messages, {
			"role": "assistant",
			"content": responseMsg
		}, {
			"role": "system",
			"content": errorMsg
		}];
		await sendChatMessage("assistant", responseMsg);
		await sendChatMessage("system", errorMsg);
		const [assistantMsg, response] = await completeAndParse(retryMessages, sentContext);
		return [assistantMsg, response];
	}
}


async function doesFileExist(uri) {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch (e) {
		return false;
	}
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
			localResourceRoots: [vscode.Uri.file(context.extensionPath)],
			canClose: false, // Disable the close button
		}
	);
	// Load the HTML content of the view
	panel.webview.html = getWebviewContent(context.extensionPath);
	
	// load the messages from the file
	
	const loadMessages = async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders[0];
		const messagesUri = workspaceFolder.uri.with({ path: workspaceFolder.uri.path + '/.chadgpt/messages.json' });
		if (await doesFileExist(messagesUri)) {
			const messages = JSON.parse(await vscode.workspace.fs.readFile(messagesUri));
			for (const { role, content, timestamp } of messages) {
				// Send the message to the web view
				panel.webview.postMessage({
					"sender": role,
					"message": content,
					timestamp,
				});
			}
		} else {
			console.log('no messages file found');
		}
	};
	await loadMessages();
	// Handle messages received from the view
	panel.webview.onDidReceiveMessage(async (message) => {
		// save the message
		console.log("received message??: ", message);
		await saveMessage(message.sender, message.message);
	});
	panel.reveal();
}


const editSelection = async (context) => {
	const editor = vscode.window.activeTextEditor;
	await createPanel(context);
	const featureDescription = await vscode.window.showInputBox({
		prompt: 'What should be done with the selected code?',
		placeHolder: 'e.g. "refactor"'
	});
	if(!featureDescription){
		return;
	}
	const selection = editor.selection;
	console.log(selection);
	const filepath = editor.document.uri.path;
	const requiredContext = [`${filepath}:${selection.start.line}-${selection.end.line}`];
	console.log("required context: ", requiredContext);
	const selectedCode = await getAdditionalContext(requiredContext);
	const prompt = getEditPrompt(selectedCode, featureDescription);
	console.log("prompt: ", prompt);
	const fileDiffs = await performTask(prompt, featureDescription);
	await applyDiffs(fileDiffs);
	vscode.window.showInformationMessage('Selection edited!!');
};


const implementFeature = async (context) => {
	const editor = vscode.window.activeTextEditor;
	await createPanel(context);
	// The code you place here will be executed every time your command is executed
	// Display a message box to the user
	// const selection = editor?.selection;
	const featureDescription = await vscode.window.showInputBox({
		prompt: 'Enter a feature description',
		placeHolder: 'e.g. "add a menu bar to the top of the page using a new component"'
	});
	if(!featureDescription){
		return;
	}
	const currentFilePath = editor.document.uri.path;
	const prompt = getImplementPrompt(featureDescription, currentFilePath);
	const fileDiffs = await performTask(prompt, featureDescription);
	await applyDiffs(fileDiffs);
	vscode.window.showInformationMessage('Feature implemented!');
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
		vscode.commands.registerCommand('chadgpt.editSelection', async () => await editSelection(context))
	);
}

function getWebviewContent(extensionPath) {
	// Read the content of chatGPTView.html
	const filePath = path.join(extensionPath, 'chatGPTView.html');
	const content = fs.readFileSync(filePath, 'utf-8');
	return content;
}


async function saveMessage(role, content) {
	const chadGptDirUri = vscode.Uri.file(path.join(vscode.workspace.rootPath, '.chadgpt'));
	const messagesFileUri = vscode.Uri.joinPath(chadGptDirUri, 'messages.json');
	const messageObj = { role, content, timestamp: Date.now() };
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


async function sendChatMessage(role, content){
	console.log('sending message', role, content)
	// Send the message to the web view
	const messageObj = { "sender": role, "message": content, timestamp: Date.now() };
	// Send the message to the web view
	panel.webview.postMessage(messageObj);
	console.log('message sent, saving');
	await saveMessage(role, content);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
