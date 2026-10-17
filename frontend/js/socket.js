(function () {
  let connection = null;

  window.aetherisSocket = {
    connect(url, options) {
      if (!url) throw new Error('A socket server URL is required.');
      if (typeof window.io !== 'function') throw new Error('Socket.IO is unavailable.');
      connection = window.io(url, options);
      return connection;
    },
    disconnect() {
      if (connection) connection.disconnect();
      connection = null;
    },
    get connection() {
      return connection;
    }
  };
})();