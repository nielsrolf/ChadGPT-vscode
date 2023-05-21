// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const {restartSandbox} = require('./runInSandbox.js');
const {createPanel} = require('./frontend.js');
const {performTask} = require('./performTask.js');


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

	// context: e.g. {"selection": "code", "currentFile": "path/to/file", "start": 1, "end": 10}
	const initialAssistantMessage = {
		"action": "view section",
		"path": filepath,
		"start": selection.start.line + 1,
		"end": selection.end.line + 1
	};
	const prompt = `Edit the selected code: ${featureDescription}`;
	await createPanel(context);
	const finalMessage = await performTask(prompt, {
		'path': filepath,
		'start': selection.start.line + 1,
		'end': selection.end.line + 1
		
	}, initialAssistantMessage);
	vscode.window.showInformationMessage(`Selection edited! ${finalMessage}`);
};


// debug asks for a command to debug, then runs it in the sandbox and sends the output back to chatgpt.
// we need to make a loop similar to performTask, but also parse the `# Shell` section, run the commands, and resond with a `# Output` section
// we ask ChatGPT also if we are done debugging, and if so, we exit the loop
async function debugCommand(context) {
	const commandPrompt = await vscode.window.showInputBox({
		prompt: 'What command would you like to debug?',
		placeHolder: 'e.g. "pytest test'
	});
	if (!commandPrompt) {
		return;
	}
	await createPanel(context);
	const task = `Debug the following command: \`${commandPrompt}\``;
	const finalMessage = await performTask(task, {}, {"action": "run command", "command": commandPrompt});
	vscode.window.showInformationMessage(`Command debugged! ${finalMessage}`);
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
	// // console.log("feature description: ", featureDescription);
	if (!featureDescription) {
		return;
	}
	let currentFilePath;
	try {
		currentFilePath = editor.document.uri.path;
	} catch (e) {
		// // console.log(e);
	}
	await createPanel(context);
	// // console.log("created panel");
	const finalMessage = await performTask(featureDescription,
		{"currentFile": currentFilePath},
		{
			"action": "show file summary",
			"path": currentFilePath
		}
	);
	// todo: sanity check that the file diffs are what chadgpt wanted
	// const validatePrompt = `You were just tasked to do the following: ${featureDescription}.You proposed the following changes: ${fileDiffs.map(renderDiffForMessage)}. Are these changes correct? If yes, answer with 'yes' - otherwise suggest a new edit.`;
	vscode.window.showInformationMessage(`Feature implemented! ${finalMessage}`);
}




function activate(context) {
	// Use the console to output diagnostic information (// // console.log) and errors (console.error)
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
