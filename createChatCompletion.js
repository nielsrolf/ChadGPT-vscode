let vscode;
try {
	vscode = require('vscode');
} catch (e) {
	// // console.log("Could not load vscode");
}
const { Configuration, OpenAIApi } = require("openai");


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


const getModel = async () => {
	const model = vscode.workspace.getConfiguration().get('chadgpt.model')
	// console.log("model from settings: ", model);
	if (model !== undefined && model !== null && model !== "") {
		return model;
	}
	const modelSelection = await vscode.window.showQuickPick([
		{
			label: 'GPT-4',
			description: 'The latest version of GPT-4',
			model: 'gpt-4'
		},
		{
			label: 'GPT-3.5 Turbo',
			description: 'The latest version of GPT-3.5 Turbo',
			model: 'gpt-3.5-turbo'
		}
	], {
		placeHolder: 'Please select a model'
	});
	// console.log("modelSelection: ", modelSelection);
	if (modelSelection) {
		// Save the model to the VSCode workspace configuration
		await vscode.workspace.getConfiguration().update('chadgpt.model', modelSelection.model, vscode.ConfigurationTarget.Global);
		return modelSelection.model;
	} else {
		vscode.window.showErrorMessage('Please select a model');
		throw new Error("Please select a model");
	}
}



const createChatCompletion = async (messages, retry=5) => {
	console.log("messages: ", messages, retry);
	const model = await getModel();
	// console.log("model: ", model);
	if (messages.length > 50) {
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
			// model: "gpt-3.5-turbo",
			model: model,
			messages: messages.map(x => {
				return {
					"role": x.role,
					"content": x.content
				}
			})
		});
		// // console.log("completion: ", completion);
		responseMsg = completion.data.choices[0].message.content;
		// // console.log("responseMsg: ", responseMsg);
	} catch (e) {
		// // console.log("OpenAI API error: ", e);
		if(retry === 0) {
			await vscode.window.showErrorMessage(`OpenAI API error: ${e.message}`);
			throw new Error("OpenAI API error");
		}
		return await createChatCompletion(messages, retry - 1);
	}
	return responseMsg;
};


module.exports = {
    createChatCompletion
};
