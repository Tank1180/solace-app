export default function PlayerList({ players, onDraft }) {
  return (
    <div style={{ width: "300px", border: "1px solid #ccc", padding: "10px" }}>
      <h3>Players</h3>

      {players.map((p) => (
        <div key={p.id} style={{ marginBottom: "10px" }}>
          {p.name} ({p.position})
          <button
            onClick={() => onDraft(p.id)}
            style={{ marginLeft: "10px" }}
          >
            Draft
          </button>
        </div>
      ))}
    </div>
  );
}