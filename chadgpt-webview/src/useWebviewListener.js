import { useEffect } from 'react';

const useWebviewListener = (handler) => {
  useEffect(() => {
    const listener = (event) => {
      if (handler) {
        handler(event);
      }
    };
    window.addEventListener('message', listener);

    return () => {
      window.removeEventListener('message', listener);
    };
  }, [handler]);
};

export default useWebviewListener;
