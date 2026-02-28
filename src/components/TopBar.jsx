function TopBar() {
  return (
    <header className="topbar" role="banner">
      <div className="topbar__model">
        <label htmlFor="model-select" className="topbar__model-label">
          Model
        </label>
        <select
          id="model-select"
          className="topbar__model-select"
          aria-label="Select model"
          defaultValue="gpt-4"
        >
          <option value="gpt-4">GPT-4</option>
          <option value="gpt-3.5">GPT-3.5</option>
          <option value="gpt-4o">GPT-4o</option>
        </select>
      </div>
    </header>
  );
}

export default TopBar;
