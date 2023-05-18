# chadgpt README

[Demo](https://youtu.be/9sS2RisrarM)

Not a maintained or reliable thing at this moment, but a very cool proof of concept.

## Features
`cmd + P` ->
- `ChadGPT: open chat`
- `ChadGPT: implement feature` - generates a file diff based on an instruction
- `ChadGPT: edit selection` - generates a file diff based on the currently selected code and an instruction
- `ChadGPT: debug command` - runs a command in a sandbox and generates file diffs until there is no more error.
    - ! Right now, you have to build your own image and tag it as `chadgpt-sandbox:latest` for this to work. See notes below.
- `ChadGPT: restart sandbox` - kills the sandbox container, rebuild the image and restarts the container

## Dev setup:
- build the frontend:
```
cd chadgpt-webview
npm install
npm run build
```
- install the dependencies of the extension: `npm install`
- Install the vscode extension from this folder via cmd+shift+P + Developer: Install extension from path


### Controlling which files are visible
!! Currently not implemented, how should this work with the sandbox?!!
Files mentioned in `.gitignore` and `.chadignore` are ignored. Files mentioned in `.chadinclude` are visible, the latter has priority over ignore rules and can be used to make docs available.

### Using the debug command
ChadGPT allows you to debug commands in a sandbox docker container. For this to work, you need to have a `Dockerfile`. ChadGPT gets access to a terminal with the `cwd` mounted and network access to perform `GET`, `HEAD` and `PUT` operations. It can modify files in the mounted directory so use with caution!

The files are added only after the image is build, so you may need to move some commands (like `pip install -r requirements.txt`) from your Dockerfile to e.g. a `setup.sh`. Then, the debug command should be: `source setup.sh && {cmd}`.

**Requirements**
- The sandbox starts an image tagged as `chadgpt-sandbox:latest`. ChadGPT should build this image if it doesn't find it, but this doesn't work currently. Add the following lines to your Dockerfile, or checkout the [Dockerfile-sandbox](Dockerfile-sandbox) as a reference:
```
RUN apt-get update && apt-get install -y iptables screen
RUN update-alternatives --set iptables /usr/sbin/iptables-legacy
RUN update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
```

## Requirements

- docker if you want to use the debug command
- your own OpenAi API key


## Release Notes


### 1.0.0

Initial version of ChadGPT
