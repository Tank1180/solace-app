import axios from "axios";

const API = "http://127.0.0.1:8000";

export const getDraftState = async (leagueId) => {
  const res = await axios.get(`${API}/draft/state/${leagueId}`);
  return res.data;
};

export const makePick = async (pick) => {
  const res = await axios.post(`${API}/draft/pick`, pick);
  return res.data;
};