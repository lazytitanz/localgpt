import { useState, useEffect, useRef } from "react";

const DEBOUNCE_MS = 300;

function Sidebar({
  groups,
  activeId,
  searchQuery,
  onSearchChange,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
}) {
  const [searchInput, setSearchInput] = useState(searchQuery || "");
  const [menuOpenId, setMenuOpenId] = useState(null);
  const debounceRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (menuOpenId == null) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpenId]);

  useEffect(() => {
    setSearchInput((prev) => (searchQuery === "" ? "" : prev));
  }, [searchQuery]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchChange(searchInput.trim());
      debounceRef.current = null;
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput, onSearchChange]);

  return (
    <nav className="sidebar" aria-label="Conversations">
      <div className="sidebar__header">
        <button className="sidebar__logo-btn" aria-label="Home" type="button">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2C6.477 2 2 6.263 2 11.5c0 2.583 1.077 4.927 2.83 6.64L4 22l4.338-1.376A10.622 10.622 0 0 0 12 21c5.523 0 10-4.263 10-9.5S17.523 2 12 2Z"
              fill="currentColor"
            />
          </svg>
        </button>
        <span className="sidebar__brand-name">LocalGPT</span>
        <button
          className="sidebar__icon-btn"
          aria-label="New chat"
          type="button"
          onClick={onNewChat}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
          </svg>
        </button>
      </div>

      <div className="sidebar__search-wrap">
        <svg className="sidebar__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          className="sidebar__search-input"
          placeholder="Search conversations"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search conversations"
        />
      </div>

      <div className="sidebar__conversations">
        {["Today", "Yesterday", "Previous 7 Days", "Older"].map((label) => {
          const items = groups[label] || [];
          if (items.length === 0) return null;
          return (
            <div key={label} className="sidebar__group">
              <div className="sidebar__group-label">{label}</div>
              {items.map((conv) => (
                <div
                  key={conv.id}
                  className={`sidebar__item-wrap${conv.id === activeId ? " sidebar__item-wrap--active" : ""}`}
                  ref={menuOpenId === conv.id ? menuRef : undefined}
                >
                  <button
                    type="button"
                    className="sidebar__item"
                    onClick={() => onSelectConversation(conv.id)}
                  >
                    {conv.title || "New conversation"}
                  </button>
                  <button
                    type="button"
                    className="sidebar__item-menu-btn"
                    aria-label="Conversation options"
                    aria-expanded={menuOpenId === conv.id}
                    aria-haspopup="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId((prev) => (prev === conv.id ? null : conv.id));
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="12" cy="5" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="12" cy="19" r="1.5" />
                    </svg>
                  </button>
                  {menuOpenId === conv.id && (
                    <div className="sidebar__item-menu" role="menu">
                      <button
                        type="button"
                        className="sidebar__item-menu-item sidebar__item-menu-item--danger"
                        role="menuitem"
                        onClick={() => {
                          onDeleteConversation?.(conv.id);
                          setMenuOpenId(null);
                        }}
                      >
                        Delete conversation
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export default Sidebar;
