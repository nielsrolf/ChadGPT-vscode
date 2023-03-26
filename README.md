# chadgpt README


Not a maintained or reliable thing at this moment, but a very cool proof of concept.
## Features
`cmd + P` ->
- `ChadGPT: open chat`
- `ChadGPT: implement feature` - generates a file diff based on an instruction
- `ChadGPT: edit selection` - generates a file diff based on the currently selected code and an instruction
- `ChadGPT: debug command` - runs a command in a sandbox and generates file diffs until there is no more error
- `ChadGPT: restart sandbox` - kills the sandbox container, rebuild the image and restarts the container

## Deb setup:
- build the frontend:
```
cd chadgpt-webview
npm run build
```
- Install the vscode extension from this folder via cmd+shift+P + Developer: Install extension from path


### Controlling which files are visible
Files mentioned in `.gitignore` and `.chadignore` are ignored. Files mentioned in `.chadinclude` are visible, the latter has priority over ignore rules and can be used to make docs available.

### Using the debug command
ChadGPT allows you to debug commands in a sandbox docker container. For this to work, you need to have a `Dockerfile`. ChadGPT gets access to a terminal with the `cwd` mounted and network access to perform `GET`, `HEAD` and `PUT` operations. It can modify files in the mounted directory so use with caution!

The files are added only after the image is build, so you may need to move some commands (like `pip install -r requirements.txt`) from your Dockerfile to e.g. a `setup.sh`. Then, the debug command should be: `source setup.sh && {cmd}`.

## Requirements

- docker if you want to use the debug command
- your own OpenAi API key


## Release Notes


### 1.0.0

Initial version of ChadGPT
