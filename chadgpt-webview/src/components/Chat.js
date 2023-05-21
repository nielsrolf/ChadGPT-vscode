import React, { useState, useRef, useEffect, useContext } from "react";
import "./Chat.css";
import Message from "./Message";
import useWebviewListener from '../useWebviewListener';
import VscodeContext from '../VscodeContext';


const Chat = () => {
  const [unsortedMessages, setMessages] = useState([]);
  // console.log("unsortedMessages", unsortedMessages[unsortedMessages.length - 1]);
  // sort messages by messageId in simple alphanumeric order
  const messagesSorted = unsortedMessages.sort((a, b) => {
    if (a.messageId < b.messageId) return -1;
    if (a.messageId > b.messageId) return 1;
    return 0;
  });
  // group messages into children
  const messages = messagesSorted.reduce((acc, message) => {
    const parentMessageId = message.messageId.split(".").slice(0, -1).join(".");
    const parentMessage = messagesSorted.find(
      (message) => message.messageId === parentMessageId
    );
    if (parentMessage) {
      parentMessage.children = parentMessage.children || [];
      // only push if it is not already a child
      if (!parentMessage.children.find((child) => child.messageId === message.messageId)) {
        parentMessage.children.push(message);
      } else {
        // if it is already a child, update the content
        parentMessage.children = parentMessage.children.map((child) => {
          if (child.messageId === message.messageId) {
            return {
              ...child,
              content: message.content,
              timestamp: message.timestamp,
            };
          }
          return child;
        });
      }
    } else {
      acc.push(message);
    }
    return acc;
  }, []);

  const [inputMessage, setInputMessage] = useState("");
  const [parentMessageId, setParentMessageId] = useState("");
  const messagesEndRef = useRef(null);
  const vscode = useContext(VscodeContext);

  const handleMessageSubmit = (e) => {
    e.preventDefault();
    if (!inputMessage) return;

    const timestamp = Date.now();
    const messageId = parentMessageId
      ? `${parentMessageId}.${timestamp}`
      : timestamp.toString();

    const newMessage = {
      role: "user",
      content: inputMessage,
      messageId,
      timestamp,
    };
    setMessages((prevMessages) => [...prevMessages, newMessage]);
    setParentMessageId(messageId);
    setInputMessage("");
    // get the history of the selected message by checking if the id is a substring of the message id
    const history = [...messagesSorted.filter(
      (message) => messageId.indexOf(message.messageId) !== -1
    ), newMessage];
    vscode.postMessage({ ...newMessage, history });
  };

  // scroll the selected message into view
  useEffect(() => {
    const selectedMessage = document.querySelector(
      `[data-message-id="${parentMessageId}"]`
    );
    if (selectedMessage) {
      selectedMessage.scrollIntoView({ behavior: "smooth" });
    } else {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [parentMessageId]);

  useWebviewListener((event) => {
    const message = event.data;
    if (message.type === "stream") {
      // console.log("webviewlistener - streaming", {message, messagesSorted, messages});
      // check if the messageId already exists, otherwise create it
      const existingMessage = messagesSorted.find(
        (i) => i.messageId === message.messageId
      );
      // console.log("webviewlistener - existingMessage", existingMessage)
      if (existingMessage !== undefined && existingMessage !== null) {
        // console.log("yo")
        const updatedMsg = {
          ...existingMessage,
          content: message.content,
          timestamp: new Date().getTime(),
        };
        // console.log("webviewlistener - updatedMsg", updatedMsg);
        setMessages((prevMessages) => {
          // console.log(prevMessages, updatedMsg)
          return [...prevMessages.filter(m => m.messageId !== message.messageId), updatedMsg];
        });
      } else {
        // console.log("webviewlistener - new message", message);
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            role: message.role,
            content: message.content,
            messageId: message.messageId,
            timestamp: message.timestamp,
          },
        ]);
      }
      return;
    }
    setMessages((prevMessages) => [
      ...prevMessages,
      {
        role: message.role,
        content: message.content,
        messageId: message.messageId,
        timestamp: message.timestamp,
      },
    ]);
    setParentMessageId(message.messageId);
  });

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.map((message) => (
          <Message
            key={message.messageId}
            message={message}
            parentMessageId={parentMessageId}
            setParentMessageId={setParentMessageId}
          />
        ))}
        <div ref={messagesEndRef}></div>
      </div>
      <form className="chat-form" onSubmit={handleMessageSubmit}>
        <textarea
          className="chat-input"
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Type your message"
        />
        <button className="chat-button" type="submit">
          Send
        </button>
      </form>
    </div>
  );
};

export default Chat;
