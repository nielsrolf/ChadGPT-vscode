
const getRepoContext = async () => {
	return "repocontext";
}


const getShortContent = async (file) => {
    const f = ["test", "test2"]
	return {
		filename: file,
		request: `- ${file}`,
		message: f.join('\n'),
		code_before: f.join('\n'),
		range: {
			start: {line: 0, character: 0},
			end: {line: 420, character: 0}
		}
	};
}


const getAdditionalContext = async (requiredContext) => {
	// returns: # file: <filepath>:<startLine>-<endLine>\n```<code>```
	// console.log(requiredContext)
	if(!requiredContext.includes(':')) {
		return await getShortContent(requiredContext);
	}
	const [filepath, lineRange] = requiredContext.split(':');
	const [startLine, endLine] = lineRange.split('-');
	const fileContents = "filecontent"
	const requiredCode = fileContents.split('\n').slice(startLine - 1, endLine).join('\n');
	const message = `# file: ${filepath}:${startLine}-${endLine}\n${requiredCode}`;
	return {
		filename: filepath,
		request: requiredContext,
		message: message,
		code_before: "code before",
		range: {
			start: {line: startLine - 1, character: 0},
			end: {line: endLine, character: 0}
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
	// console.log({responseMsg, requiredContextSection, requiredContextArray, requiredContext, sentContext});
	return requiredContext;
}



const parseResponseFileDiffs = async (responseMsg) => {
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
		const [startLine, endLine] = (fromTo.split(' -> ')[0]+ '-').split('-');
		const codeBefore = "code before"
		// await sendChatMessage("assistant", `# Edits:\n- ${filepath}:${startLine}-${endLine}\n\`\`\`${newCode}\`\`\``, responseMsgId);
		return {
			filepath, range: {
				start: {line: startLine, character: 0},
				end: {line: endLine, character: 0}
			},
			code_after: newCode,
			code_before: codeBefore,
			message: `- ${filepath}:${startLine}-${endLine}\n\`\`\`${newCode}\`\`\``
		}
	}));
	return parsedFileDiffs;
}


const parseResponse = async (responseMsg, sentContext) => {
	// parse response: get sections for required context and file diffs
	let requiredContext = [];
	let fileDiffs = [];
	if(responseMsg.indexOf('# Required context') !== -1) {
		// parse fileDiffs
		requiredContext = await parseResponseRequiredContext(responseMsg, sentContext);	
	}
	// if(responseMsg.indexOf('# Edits') !== -1) {
	// 	// parse required context
	// 	fileDiffs = await parseResponseFileDiffs(responseMsg);
		
	// }
	if(requiredContext.length > 0 || fileDiffs.length > 0) {
		let message = "";
		let displayMessage = "";
		if(requiredContext.length > 0) {
			message += `# Required context:\n${requiredContext.map(x => `- ${x.requestMessage}`).join('\n')}\n`;
			displayMessage += `# Required context:\n${requiredContext.map(x => `- ${x.message}`).join('\n')}\n`;
		}
		if(fileDiffs.length > 0) {
			message += `# Edits:\n${fileDiffs.map(x => x.message).join('\n')}\n`;
			displayMessage += `# Edits:\n${fileDiffs.map(x => x.message).join('\n')}\n`;
		}
		return {requiredContext, fileDiffs, message, displayMessage};
	}
	throw new Error("Response must include either '# Required context' or '# Edits'");
}

async function mainModule() {
    const data = {
        "responseMsg": "# Required context\n- /Users/nielswarncke/Documents/ChadGPT-vscode/example.py\n\n# Edits\n- /Users/nielswarncke/Documents/ChadGPT-vscode/example.py:1-3\n```\n# import the necessary libraries\nimport random\nimport simpleaudio as sa\n\n# set global variables\nbpm = 120\nsamples_per_measure = 16\n\n# define the instrument sounds\nkick = sa.WaveObject.from_wave_file(\"kick.wav\")\nsnare = sa.WaveObject.from_wave_file(\"snare.wav\")\nhihat = sa.WaveObject.from_wave_file(\"hihat.wav\")\n\n# define the song structure\ndef make_song():\n\t# initialize an empty song\n\tsong = []\n\t\n\t# add 4 measures to the song\n\tfor measure in range(4):\n\t\t# add a kick every beat\n\t\tfor beat in range(samples_per_measure):\n\t\t\tif beat % 4 == 0:\n\t\t\t\tsong.append(kick)\n\t\t\t# add a snare on the 2nd and 4th beat\n\t\t\telif beat % 4 == 2:\n\t\t\t\tsong.append(snare)\n\t\t\t# add a hihat on every 16th note\n\t\t\telif beat % 2 == 0:\n\t\t\t\tsong.append(hihat)\n\t\t\telse:\n\t\t\t\tsong.append(None)\n\t\t\t\t\n\treturn song\n\n# play the song\ndef play_song(song):\n\t# create a list of all the sounds in the song\n\tsounds = [sound for sound in song if sound is not None]\n\t\n\t# calculate the duration of a measure in seconds\n\tmeasure_duration = 60 / bpm * 4\n\t\n\t# play the song measure by measure\n\tfor measure in range(4):\n\t\t# play each sound in the measure\n\t\tfor beat in range(samples_per_measure):\n\t\t\t# calculate the time when the sound should be played\n\t\t\tsound_time = measure * measure_duration + beat * (measure_duration / samples_per_measure)\n\t\t\t\n\t\t\t# play the sound (if it exists)\n\t\t\tif song[measure * samples_per_measure + beat] is not None:\n\t\t\t\tsounds[song.index(song[measure * samples_per_measure + beat])].play().wait_done()\n\t\t\t\t\n# create the song and play it\nsong = make_song()\nplay_song(song)\n```"
    }
    // console.log(data.responseMsg)
    const parsed = await parseResponse(data.responseMsg, []);
    // console.log(parsed);
}

mainModule();