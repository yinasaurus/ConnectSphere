/**
 * SCRUM-76 AC1: the hold expiry timer starts with the server, with no user action, and stops
 * when the server shuts down.
 *
 * Labels:
 *   US76-S..  server start-up and shutdown (src/server.js)
 *
 * server.js listens on a port as soon as it is required, so the app, env and job are mocked:
 * no port is opened and no real timer starts.
 */
const mockListen = jest.fn();
const mockClose = jest.fn((done) => done());
const mockStop = jest.fn();
const mockNotificationTimer = {};
const mockSetInterval = jest.fn(() => mockNotificationTimer);
const mockClearInterval = jest.fn();

jest.mock('../src/app', () => ({
  createApp: () => ({ listen: mockListen }),
}));
jest.mock('../src/config/env', () => ({
  env: { port: 4999, holdNotificationPollMs: 30_000 },
}));
jest.mock('../src/jobs/holdExpiry.job', () => ({
  startHoldExpiryJob: jest.fn(() => mockStop),
}));
jest.mock('../src/services/venues.service', () => ({
  processDueHoldNotifications: jest.fn().mockResolvedValue({
    warningsSent: 0,
    expiryNoticesSent: 0,
  }),
}));

const { startHoldExpiryJob } = require('../src/jobs/holdExpiry.job');

describe('SCRUM-76 server starts and stops the expiry timer', () => {
  let handlers;
  let exitSpy;
  let logSpy;

  beforeAll(() => {
    handlers = {};
    mockListen.mockImplementation((_port, onListening) => {
      onListening();
      return { close: mockClose };
    });
    jest.spyOn(process, 'on').mockImplementation((signal, handler) => {
      handlers[signal] = handler;
      return process;
    });
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(global, 'setInterval').mockImplementation(mockSetInterval);
    jest.spyOn(global, 'clearInterval').mockImplementation(mockClearInterval);
    jest.isolateModules(() => {
      require('../src/server');
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('US76-S01: starting the server starts the hold expiry timer once, with no user action', () => {
    expect(mockListen).toHaveBeenCalledWith(4999, expect.any(Function));
    expect(logSpy).toHaveBeenCalledWith('ConnectSphere API listening on http://localhost:4999');
    expect(startHoldExpiryJob).toHaveBeenCalledTimes(1);
    expect(startHoldExpiryJob).toHaveBeenCalledWith();
    expect(mockSetInterval).toHaveBeenCalledTimes(1);
    expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it.each(['SIGINT', 'SIGTERM'])('US76-S02: %s stops the timer, then closes the server', (signal) => {
    mockStop.mockClear();
    mockClose.mockClear();
    exitSpy.mockClear();
    mockClearInterval.mockClear();

    handlers[signal]();

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockClearInterval).toHaveBeenCalledWith(mockNotificationTimer);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
