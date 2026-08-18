import axios from "axios";

const API = "http://127.0.0.1:8000";

export const getTeams = async (leagueId) => {
  const res = await axios.get(`${API}/teams/league/${leagueId}`);
  return res.data;
};