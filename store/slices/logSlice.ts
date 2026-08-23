import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { LogEntry } from '../../types';

interface LogState {
  logs: LogEntry[];
}

const initialState: LogState = {
  logs: [],
};

const logSlice = createSlice({
  name: 'logs',
  initialState,
  reducers: {
    addLog(state, action: PayloadAction<{ message: string; data?: any }>) {
      const timestamp = new Date().toLocaleTimeString();
      state.logs.push({
        timestamp,
        message: action.payload.message,
        data: action.payload.data ? JSON.stringify(action.payload.data, null, 2) : undefined
      });
    },
    clearLogs(state) {
      state.logs = [];
    },
  },
});

export const { addLog, clearLogs } = logSlice.actions;
export default logSlice.reducer;
