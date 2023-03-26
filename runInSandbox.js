const Docker = require('dockerode');
const fs = require('fs');
const tar = require('tar-fs');
let vscode;
try {
	vscode = require('vscode');
} catch (e) {
	console.log("Could not load vscode");
}


const docker = new Docker({
    socketPath: '/var/run/docker.sock',
});
const imageName = 'chadgpt-sandbox';


async function buildImage() {
    const dockerfileContents = fs.readFileSync('./Dockerfile', 'utf-8');
    const newDockerfileContents = `${dockerfileContents}\nRUN apt-get update && apt-get install -y iptables tmux\nRUN update-alternatives --set iptables /usr/sbin/iptables-legacy\nRUN update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy`;

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
                console.log(err);
                reject(err);
            } else {
                resolve(res);
            }
        }, (event) => {
            console.log(event.stream ? event.stream.trim() : event);
        });
    });
}


async function getOrCreateImage() {
    console.log(process.cwd());
    const images = await docker.listImages();
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

    // get the image
    const imageInfo = await getOrCreateImage();

    // define options for the container

    const containerOptions = {
        Image: imageInfo.RepoTags[0],
        Tty: true,
        Cmd: ['/bin/bash', '-c', 'iptables -A OUTPUT -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -m multiport --dports 80,443 ! --syn -m comment --comment "Block POST and PUT requests" -j DROP && tmux new-session -s sandbox -n shell -d && sleep infinity'],
        HostConfig: {
            Binds: [`${__dirname}:${__dirname}`],
            WorkingDir: `${__dirname}`,
            Privileged: true,
            AutoRemove: true,
        },
        name: 'chadgpt-sandbox',
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        StdinOnce: false,
    };
    // create and start the container
    const container = await docker.createContainer(containerOptions);
    await container.start();
    // wait 1 second
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return container;
}


async function runInSandbox(cmd) {
    let container = await createOrGetSandbox();
    const exec = await container.exec({
        AttachStdout: true,
        AttachStderr: true,
        Cmd: ["bash", "-c", `tmux send-keys -t sandbox:shell.0 "${cmd}" C-m && tmux capture-pane -t sandbox:shell.0 -e -S - -E - && tmux show-buffer && tmux delete-buffer`],
    });

    let output = "";
    try {
        await new Promise((resolve, reject) => {
            exec.start({ hijack: true, stdin: true }, (err, stream) => {
                if (err) reject(err);
                
                stream.on("data", (data) => {
                    output += data.toString();
                });
                
                stream.on("end", () => {
                    // stop waiting for more output.
                    reject(new Error("Command executed."));
                });
            });
        });
    } catch (err) {
        if (err.message !== "Command executed.") {
            throw err;
        }
        return output;
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


async function runCommandsInSandbox(commands) {
    await runInSandbox('echo chadgpt-sandbox-start');
    // set the vscode home dir as cwd for the command
    const homeDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
    await runInSandbox(`cd ${homeDir}`);
    for (const command of commands) {
        await runInSandbox(command);
    }
    const output = await runInSandbox('chadgpt-sandbox-end');
    // return the last captured output
    return output.split('chadgpt-sandbox-start').slice(-1)[0]
                 .split('chadgpt-sandbox-end')[0].trim();
}

// runCommandsInSandbox(['which python', 'python music.py']).then((output) => {
//     console.log(output);
// }).catch((err) => {
//     console.log(err);
// });


module.exports = {
    runCommandsInSandbox,
    restartSandbox,
};