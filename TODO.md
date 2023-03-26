TODO




- check if it can create new files

- refactor extension.js into multiple smaller files

- when multiple diffs apply in the same file, correct the line numbers of the later diffs
    - or apply the last diff first?


- debug command:
    - specify command
    - run command
    - get output and errors
    - send to chatgpt:
        - same prompt es implement, but with
        # Output:
        ...
        section in the prompt, and response format: # Required context | # Edit | # Shell
    -

- after applying diff, send new code again and ask for replacement

- auto improve mode:
    - refactor file by file
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