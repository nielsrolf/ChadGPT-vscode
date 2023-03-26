TODO

- debug command:
    - test for response parsing
    - include in prompt: are you done?

- after applying diff, send new code again and ask for replacement


- check:
    - check if it can create new files
    - check if it can create multiple file diffs at once

- refactor extension.js into multiple smaller files


- auto improve mode:
    - add tests if needed
    - debug tests
    

files
- chatview.js
- completeAndParse.js
- 


fileDiff: {
    range: {
        start: {
            line: int,
            character: int
        },
        end: {
            line: int,
            character: int
        }
    },
    code_before: str,
    code_after: str.
    message: `- ${filepath}:${startLine}-${endLine}\n\`\`\`${newCode}\`\`\``
}


requiredContent: {
    message: str  '# file: <filepath>:<startLine>-<endLine>\n```<code>````'
    request: str  '# file: <filepath>:<startLine>-<endLine>'
    filename: str,
    range: {
        start: {
            line: int,
            character: int
        },
        end: {
            line: int,
            character: int
        }
    },
}


problem:
we want to display parsed responses once, but keep a message history with assistant/system message pair

solution:
we make hidden messages and a new message type for parsed responses

sendParsedResponseToChat(currentMessageId, assistantResponse, systemResponse?)