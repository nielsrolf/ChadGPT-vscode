
const getShortContent = async (file) => {
	const message = `- ${file}\n\`\`\`...\`\`\``
	return {
		filename: file,
		request: `- ${file}`,
		message: message,
		code_before: f.join('\n'),
		range: {
			start: { line: 0, character: 0 },
			end: { line: 420, character: 0 }
		}
	};
}


const getAdditionalContext = async (requiredContext) => {
	// console.log(requiredContext)
	if (!requiredContext.includes(':')) {
		return await getShortContent(requiredContext);
	}
	const [filepath, lineRange] = requiredContext.split(':');
	let [startLine, endLine] = lineRange.split('-');
	endLine = endLine || startLine;
	const requiredCode = `...`;
	const message = `- ${filepath}:${startLine}-${endLine}\n\`\`\`${requiredCode}\`\`\``;
	return {
		filename: filepath,
		request: requiredContext,
		message: message,
		code_before: `...`,
		range: {
			start: { line: startLine - 1, character: 0 },
			end: { line: endLine, character: 0 }
		}
	}
}

const getRepoContext = async (context) => {
	return "...";
}



module.exports = {
	getShortContent,
	getAdditionalContext,
	getRepoContext
}