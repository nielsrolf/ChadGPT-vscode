let vscode;
try {
	vscode = require('vscode');
} catch (e) {
	// console.log("Could not load vscode");
}
const path = require('path');


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

	let fileContents = 'File does not exist';
	let lineCount = 0;
	try {
		const document = await vscode.workspace.openTextDocument(file);
		fileContents = addLineNumbers(document.getText()).split('\n');
		lineCount = document.lineCount;
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
	const message = `- ${file}\n\`\`\`${f.join('\n')}\`\`\`To see the full code, specify the line range in the format ${file}:<startLine>-<endLine>.`
	return {
		filename: file,
		request: `- ${file}`,
		message: message,
		code_before: f.join('\n'),
		range: {
			start: { line: 0, character: 0 },
			end: { line: lineCount, character: 0 }
		}
	};
}


const getRepoContext = async () => {
	const srcFiles = await getContextFiles();
	// console.log("srcFiles: ", srcFiles)
	return srcFiles.map(i => i.path).join('\n');
	// const fileContents = await Promise.all(srcFiles.map(getShortContent));
	// // make it a string
	// const fileContentsString = fileContents.map(file => `# file: ${file.filename}\n${file.content}`).join('\n');
	// return fileContentsString;
}


const getAdditionalContext = async (requiredContext) => {
	// returns: # file: <filepath>:<startLine>-<endLine>\n```<code>```
	// console.log(requiredContext)
	if (!requiredContext.includes(':')) {
		return await getShortContent(requiredContext);
	}
	const [filepath, lineRange] = requiredContext.split(':');
	let [startLine, endLine] = lineRange.split('-');
	endLine = endLine || startLine;
	let fileContents = 'File does not exist';
	let code_before = '';
	try {
		const document = await vscode.workspace.openTextDocument(filepath);
		fileContents = addLineNumbers(document.getText());
		code_before = document.getText().split('\n').slice(startLine - 1, endLine).join('\n');
	} catch (e) {
		// console.log(e);
	 }

	const requiredCode = fileContents.split('\n').slice(startLine - 1, endLine).join('\n');
	const message = `- ${filepath}:${startLine}-${endLine}\n\`\`\`${requiredCode}\`\`\``;
	return {
		filename: filepath,
		request: requiredContext,
		message: message,
		code_before: code_before,
		range: {
			start: { line: startLine - 1, character: 0 },
			end: { line: endLine, character: 0 }
		}
	}
};



const addLineNumbers = (fileContent) => {
	const lines = fileContent.split('\n');
	const numberedLines = lines.map((line, index) => `${index + 1}: ${line}`);
	return numberedLines.join('\n');
};


module.exports = {
	getRepoContext,
	getAdditionalContext,
	getContextFiles
};