import React, { useState, useCallback } from "react";
import "./Message.css";


const parseMessage = (responseMsg) => {
    console.log('parsing message', responseMsg);
    responseMsg = responseMsg.trim().replace('```python', '```')
        .replace('```javascript', '```')
        .replace('```bash', '```')
        .replace('```json', '```')
        .replace('```js', '```')
        .replace('```py', '```')
        .replace('```sh', '```')
        .replace('```ts', '```')
        .replace('```typescript', '```')
        .replace('```html', '```')
        .replace('```css', '```')
        .replace('```scss', '```')
        .replace('```yaml', '```')
        .replace('```yml', '```')
        .replace('```xml', '```')
        .replace('```c', '```')
        .replace('```cpp', '```');

    try {
        if (responseMsg.includes('```')) {
            const responseParts = responseMsg.split('```');
            const response = JSON.parse(responseParts[0]);
            // remove the final ``` from the response
            if (responseParts[1].endsWith('```')) {
                responseParts[1] = responseParts[1].substring(0, responseParts[1].length - 3);
            }
            // filter only lines that are in the new range
            const codeLines = responseParts[1].trim().split('\n');
            const newLines = codeLines.map(line => {
                console.log('checkinf if we should use', line);
                const lineNum = parseInt(line.split(':')[0]);
                if (lineNum >= response.start)
                    // remove line numbers (e.g. '10:') from the response if they exist
                    return line.split(': ').slice(1).join(':');
                if (isNaN(lineNum) || response.start === undefined) 
                    return line;
                return null;

            }).filter(line => line !== null);
            response.content = newLines.join('\n');
            console.log({codeLines, newLines, response})
            return response;
        } else {
            let response = JSON.parse(responseMsg);
            if(response.error) {
                response.color = 'red';
                response.content = response.error;
                delete response.error;
            }
            return response;
        }
    } catch (e) {
        try {
            return JSON.parse(responseMsg);
        } catch (e) {
            console.log('error parsing', responseMsg);
            return {
                "action": "Message",
                "info": responseMsg
            };
        }
    }
}



const CodeBlock = ({ code, color }) => {
    console.log("code", code);
    const [isCopied, setIsCopied] = useState(false);
    if(code === undefined) {
        code = '';
    }


    let style = {};
    let displayCode = code;
    if (color === "red") {
        // transparent dark red background
        style = {
            backgroundColor: "rgba(255, 0, 0, 0.1)",
        };
        displayCode = code.slice(6);
    }
    // remove line numbers if they exist (e.g. 100:some code -> some code)
    displayCode = displayCode.replace(/(\d+):/g, "");

    const handleCopyClick = useCallback((event) => {
        navigator.clipboard.writeText(displayCode).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
        event.stopPropagation();
    }, [displayCode]);

    return (
        <div className="code-block">
            <button className="copy-button" onClick={handleCopyClick}>
                {isCopied ? "Copied" : "Copy"}
            </button>
            <pre style={style}>{displayCode}</pre>
        </div>
    );
};

const Message = ({ message, parentMessageId, setParentMessageId }) => {
    const [expanded, setExpanded] = useState(true);
    const handleClick = (event) => {
        if (window.getSelection().toString()) {
            return;
        }
        setParentMessageId((prevParentMessageId) => {
            console.log("prevParentMessageId", prevParentMessageId);
            if (prevParentMessageId === message.messageId) {
                return "";
            } else {
                return message.messageId;
            }
        });
        // prevent the click to bubble up to the parent message
        // so that the parent message is not selected
        event.stopPropagation();
    };

    const handleCloseClick = (event) => {
        setExpanded(!expanded)
        event.stopPropagation();
    };

    // const renderContent = (content) => {
    //     const codeRegex = /```([\s\S]*?)```/g;
    //     const parts = content.split(codeRegex);
    //     return parts.map((part, index) => {
    //         if (index % 2 === 1) {
    //             return <CodeBlock key={index} code={part} />;
    //         } else {
    //             return part.split("\n").map((line, i) => {
    //                 if (line.trim().startsWith("#")) {
    //                     return <span key={`${index}-${i}`} style={{ fontWeight: "bold", fontSize: "1.5em" }}><br />{line}<br /></span>;
    //                 } else {
    //                     return <React.Fragment key={`${index}-${i}`}>{line}<br /></React.Fragment>;
    //                 }
    //             });
    //         };
    //     });
    // };
    const renderContent = (messageRaw) => {
        console.log("messageRaw", messageRaw);
        // if message is string, parse it
        const message = parseMessage(messageRaw);
        console.log("messageParsed", message);
        const renderJson = (json) => {
            if (typeof json === "string") {
                return <span className="json-string">{json}</span>;
            } else if (typeof json === "number") {
                return <span className="json-number">{json}</span>;
            } else if (typeof json === "boolean") {
                return <span className="json-boolean">{json ? "true" : "false"}</span>;
            } else if (json === null) {
                return <span className="json-null">null</span>;
            } else if (Array.isArray(json)) {
                return (
                    <ul className="json-array">
                        {json.map((item, index) => (
                            <li key={index}>{renderJson(item)}</li>
                        ))}
                    </ul>
                );
            } else {
                return (
                    <ul className="json-object">
                        {Object.keys(json).map((key, index) => (
                            <li key={index}>
                                <span className="json-key"><b>{key}</b></span>: {renderJson(json[key])}
                            </li>
                        ))}
                    </ul>
                );
            }
        };
        // return <>json <Code></>
        let messageNoCode = {...message};
        delete messageNoCode.content;
        return (
            <div className="json-message">
                <span className="json-label">{renderJson(messageNoCode)}</span>
                {message.content && <CodeBlock code={message.content} color={message.color} />}
            </div>
        )
    };

    // add a blue line around the message if it is currently selected
    let maybeSelectedStyle = {};
    if (message.messageId === parentMessageId) {
        maybeSelectedStyle.border = "1px solid #22ccbb";
    }
    // show only first 80 characters of the message if it is not expanded
    const displayedContent = expanded ? renderContent(message.content) : '...';
    const children = expanded ? (message.children || []) : [];
    // if the message is not from assistant and has no children, add a loading icon
    const maybeLoadingIcon = message.role !== "assistant" && children.length === 0 ? (
        <span className="loading-icon" />
    ) : null;

    return (
        <div className={`chat-row-${message.role}`}
            data-message-id={message.messageId}
            onClick={handleClick}
            style={maybeSelectedStyle}>
            <div className="expand-button" onClick={handleCloseClick}>
                <button className="close-button">
                    {expanded ? "[-]" : "[+]"}
                </button>
                <strong>{message.role}: </strong>
            </div>
            <br />
            {displayedContent}
            {/* add child messages */}
            {(children).map((childMessage) => (
                <Message key={childMessage.messageId}
                    message={childMessage}
                    parentMessageId={parentMessageId}
                    setParentMessageId={setParentMessageId} />
            ))}
            {maybeLoadingIcon}
        </div>
    );
};

export default Message;