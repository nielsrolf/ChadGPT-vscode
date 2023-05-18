const Docker = require('dockerode');
const fs = require('fs');
const tar = require('tar-fs');
const {streamToFrontend} = require('./frontend.js');

let vscode;
try {
	vscode = require('vscode');
} catch (e) {
	// console.log("Could not load vscode");
}


const docker = new Docker({
    socketPath: '/var/run/docker.sock',
});
const imageName = 'chadgpt-sandbox:latest';


async function buildImage() {
    const dockerfileContents = fs.readFileSync('./Dockerfile', 'utf-8');
    const newDockerfileContents = `${dockerfileContents}\nRUN touch /tmp/chadgpt-history \nRUN apt-get update && apt-get install -y iptables screen\nRUN update-alternatives --set iptables /usr/sbin/iptables-legacy\nRUN update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy`;

    fs.writeFileSync('./Dockerfile-sandbox', newDockerfileContents, 'utf-8');

    const tarStream = tar.pack(process.cwd(), {
        entries: ['Dockerfile-sandbox'],
    });

    const stream = await docker.buildImage(tarStream, {
        t: imageName + ':latest',
        dockerfile: 'Dockerfile-sandbox',
    });

    await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (err, res) => {
            if (err) {
                // console.log(err);
                reject(err);
            } else {
                resolve(res);
            }
        }, (event) => {
            // console.log(event.stream ? event.stream.trim() : event);
        });
    });
}


async function getOrCreateImage() {
    const images = await docker.listImages();
    console.log("images", images.map(image => image.RepoTags));
    const imageExists = images.some(image => {
        return image.RepoTags.includes(imageName);
    });

    if (!imageExists) {
        await buildImage();
    }

    const imageInfo = await docker.getImage(imageName).inspect();
    return imageInfo;
}


async function createOrGetSandbox() {
    // check if a container with the given name exists
    const existingContainers = await docker.listContainers({
        all: true,
        filters: JSON.stringify({ name: ['chadgpt-sandbox'] }),
    });
    if (existingContainers.length > 0) {
        // check if the container is running
        if (existingContainers[0].State === 'running') {
            return docker.getContainer(existingContainers[0].Id);
        }
        // if the container is not running, remove it
    const container = docker.getContainer(existingContainers[0].Id);
        await container.remove();
    }
    console.log("Creating new sandbox");
    // get the image
    const imageInfo = await getOrCreateImage();
    console.log("imageInfo", imageInfo);
    // define options for the container
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    const containerOptions = {
        Image: imageInfo.RepoTags[0],
        Tty: true,
        Cmd: ['/bin/bash', '-c', 'iptables -A OUTPUT -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -m multiport --dports 80,443 ! --syn -m comment --comment "Block POST and PUT requests" -j DROP && screen -S sandbox -dm && sleep infinity'],
        HostConfig: {
            Binds: [`${workspaceFolder}:${workspaceFolder}`],
            WorkingDir: `${workspaceFolder}`,
            Privileged: true,
            AutoRemove: true,
        },
        name: 'chadgpt-sandbox',
    };
    // create and start the container
    const container = await docker.createContainer(containerOptions);
    console.log("container", container);
    await container.start();
    // wait 1 second
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return container;
}


const hash = (str) => {
    let hashValue = 0;
    for (let i = 0; i < str.length; i++) {
        hashValue = (31 * hashValue + str.charCodeAt(i)) >>> 0;
    }
    console.log("hashValue", hashValue);
    return `${hashValue}`;
};


const getStreamFile = (streamId) => {
    return `/tmp/${hash(streamId)}`;
};
/**
 * run a command in the sandbox and return the captured output.
 * Commands are run in a tmux session called sandbox.
 * 
 * Example:
 * let out1 = await runInSandbox('cd /tmp')
 * let out2 = await runInSandbox('pwd')
 * out2 === '/tmp'
 */
async function runInSandbox(cmd, streamId) {
    let container = await createOrGetSandbox();
    const endToken = Math.random().toString(36).substring(7);
    // escape the cmd to prevent it from being interpreted by the shell.
    cmd = cmd.replace(`\\`, `\\\\`).replace('$', '\\$');
    const cmdWritingToHistory = `${cmd} > ${getStreamFile(streamId)} 2>&1 && echo ${endToken} >> ${getStreamFile(streamId)} || echo ${endToken} >> ${getStreamFile(streamId)}`;
    const exec = await container.exec({
        Cmd: ['screen', '-S', 'sandbox', '-X', 'stuff', `${cmdWritingToHistory}`+'\n'],
        AttachStderr: true,
    });
    await exec.start({ hijack: true, stdin: true });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return waitForEndToken(container, endToken, streamId);
}


async function waitForEndToken(container, endToken, streamId) {
    // console.log("streamId", streamId);
    const history = await container.exec({
        Cmd: ['cat', `${getStreamFile(streamId)}`],
        AttachStdout: true,
        AttachStderr: true,
    });
    const historyStream = await history.start({ hijack: true, stdin: true });
    const historyOutput = await new Promise((resolve) => {
        historyStream.on('data', async (data) => {
            resolve(data.toString());
            if(streamId) {
                streamToFrontend(streamId, data.toString().split(endToken)[0]);
            }
        });
    });
    if (!historyOutput.includes(endToken)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return waitForEndToken(container, endToken, streamId);
    } else {
        return historyOutput.split(endToken)[0];
    }
}


async function restartSandbox() {
    await buildImage();
    // kill sandbox if running
    const existingContainers = await docker.listContainers({
        all: true,
        filters: JSON.stringify({ name: ['chadgpt-sandbox'] }),
    });
    if (existingContainers.length > 0) {
        const container = docker.getContainer(existingContainers[0].Id);
        await container.stop();
        await container.remove();
    }
    // create new sandbox
    await createOrGetSandbox();
}


async function runCommandsInSandbox(commands, streamId) {
    // console.log("running commands:", commands, streamId);
    // set the vscode home dir as cwd for the command
    const homeDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
    // const homeDir = '/Users/nielswarncke/Documents/ChadGPT-vscode';
    await runInSandbox(`cd ${homeDir}`, streamId);

    let output = ""
    for (const command of commands) {
        if (typeof command == "string") {
            const tmp = await runInSandbox(command, streamId);
            output += `> ${command}\n${tmp}\n\n`;
        }
    }

    // const output = await runInSandbox(`echo done ${endToken}`);
    return output;
}

// restartSandbox();

async function testCommands() {
    for(let i = 0; i < 1; i++) {
        let output = await runCommandsInSandbox(['pwd', 'python music.py', 'export a=1', 'echo $a', 'pip install numpy']);
        // console.log(output, i);

    }
}
// testCommands();


module.exports = {
    runCommandsInSandbox,
    restartSandbox,
};