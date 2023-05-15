let vscode;
try {
	vscode = require('vscode');
} catch (e) {
	console.log("Could not load vscode");
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


const createChatCompletion = async (messages) => {
	console.log("messages: ", messages);
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
			model: "gpt-3.5-turbo",
			// model: "gpt-4",
			messages: messages.map(x => {
				return {
					"role": x.role,
					"content": x.content
				}
			})
		});
		responseMsg = completion.data.choices[0].message.content;
		console.log("responseMsg: ", responseMsg);
	} catch (e) {
		console.log(e);
		throw new Error("OpenAI API error");
	}
	return responseMsg;
};


module.exports = {
    createChatCompletion
};
