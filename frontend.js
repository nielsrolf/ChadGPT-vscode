let vscode;
try {
	vscode = require('vscode');
} catch (e) {
	// // console.log("Could not load vscode");
}
const path = require('path');
const fs = require('fs');
const {createChatCompletion} = require('./createChatCompletion');



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
			// // console.log('no messages file found');
		}
	};
	await loadMessages();
	// Handle messages received from the view
	panel.webview.onDidReceiveMessage(async (message) => {
		// // console.log("received message", message);
		// save the message
		await saveMessage(message.role, message.content, message.messageId);
		// send the message to the assistant
		const response = await getAssistantResponse(message.history);
		// // console.log({ response });
		// send the response to the view
		const timestamp = new Date().getTime();
		const responseId = `${message.messageId}.${timestamp}`
		await saveMessage("assistant", response, responseId);
		// // console.log("saved")
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


async function saveMessage(role, content, messageId = Date.now().toString()) {
	const chadGptDirUri = vscode.Uri.file(path.join(vscode.workspace.rootPath, '.chadgpt'));
	const messagesFileUri = vscode.Uri.joinPath(chadGptDirUri, 'messages.json');
	const messageObj = { role, content, messageId };
	try {
		await vscode.workspace.fs.createDirectory(chadGptDirUri);
	} catch (error) {
		// // console.log(error, error.code);
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
			// // console.log("wtf");
			// // console.log(error.code);
			// // console.log(error);
			// // console.log(role, content);
			// // console.log("message not saved", error);
		}
	}
}


async function sendChatMessage(role, content, messageId) {
	// Send the message to the web view
	const messageObj = { "role": role, "content": content, "messageId": messageId };
	// // console.log('sending message', messageObj)
	// Send the message to the web view
	panel.webview.postMessage(messageObj);
	// // console.log('message sent, saving');
	await saveMessage(role, content, messageId);
}



const streamToFrontend = (messageId, newContent) => {
	if (!newContent) return;
	// // console.log({ messageId })
	const formattedContent = JSON.stringify({
		'action': 'stream',
		'content': newContent
	}, null, 2);
	const messageObj = { "type": "stream", "messageId": messageId, "role": "system", "content": formattedContent };
	// // console.log('streaming', messageObj);
	// Send the message to the web view
	// console.log('streaming', messageObj);
	panel.webview.postMessage(messageObj);
};



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
    const responseMsg = await createChatCompletion(messages);
	// // console.log(responseMsg);
	const formattedMsg = responseMsg
		.replace('```javascript', '```')
		.replace('```js', '```')
		.replace('```python', '```')
		.replace('```py', '```')

	return formattedMsg;
}


module.exports = {
    createPanel,
    sendChatMessage,
    saveMessage,
	streamToFrontend
}