import React, { useState, useCallback } from "react";
import "./Message.css";

const CodeBlock = ({ code }) => {
    const [isCopied, setIsCopied] = useState(false);


    let style = {};
    let displayCode = code;
    if (code.startsWith("before")) {
        // transparent dark red background
        style = {
            backgroundColor: "rgba(255, 0, 0, 0.1)",
        };
        displayCode = code.slice(6);
    }
    if (code.startsWith("after")) {
        // transparent dark green background
        style = {
            backgroundColor: "rgba(0, 255, 0, 0.1)",
        };
        displayCode = code.slice(5);
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

    const renderContent = (content) => {
        const codeRegex = /```([\s\S]*?)```/g;
        const parts = content.split(codeRegex);
        return parts.map((part, index) => {
            if (index % 2 === 1) {
                return <CodeBlock key={index} code={part} />;
            } else {
                return part.split("\n").map((line, i) => {
                    if (line.trim().startsWith("#")) {
                        return <span key={`${index}-${i}`} style={{ fontWeight: "bold", fontSize: "1.5em" }}><br />{line}<br /></span>;
                    } else {
                        return <React.Fragment key={`${index}-${i}`}>{line}<br /></React.Fragment>;
                    }
                });
            };
        });
    };

// add a blue line around the message if it is currently selected
let maybeSelectedStyle = {};
if (message.messageId === parentMessageId) {
    maybeSelectedStyle.border = "1px solid #22ccbb";
}
// show only first 80 characters of the message if it is not expanded
const displayedContent = expanded ? message.content : message.content.slice(0, 80);
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
        {renderContent(displayedContent)}
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