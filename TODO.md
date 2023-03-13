TODO
- after applying diff, send new code again and ask for replacement
- when multiple diffs apply in the same file, correct the line numbers of the later diffs
    - or apply the last diff first?

- edit selection command:
    - new prompt to edit selection

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

- add chat window
    - show nested structure of conversations by adding indent to recursive completeAndParse
    - delete messages and children
    


in this vscode extension I want to add a section on the right sidebar for it. It should show a chat window.