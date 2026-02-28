import { useState, useEffect, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import * as api from "./api";
import "./App.css";

function groupByDate(conversations) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const groups = { Today: [], Yesterday: [], "Previous 7 Days": [], Older: [] };
  for (const c of conversations) {
    const t = new Date(c.updated_at || c.created_at).getTime();
    const dayStart = new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate()).getTime();
    const diff = todayStart - dayStart;
    if (diff <= 0) groups.Today.push(c);
    else if (diff <= oneDay) groups.Yesterday.push(c);
    else if (diff <= 7 * oneDay) groups["Previous 7 Days"].push(c);
    else groups.Older.push(c);
  }
  return groups;
}

function App() {
  const [conversations, setConversations] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentConversation, setCurrentConversation] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);

  const fetchConversations = useCallback(async (q = "") => {
    try {
      const list = await api.getConversations(q);
      setConversations(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error(e);
      setConversations([]);
    }
  }, []);

  useEffect(() => {
    fetchConversations(searchQuery);
  }, [searchQuery, fetchConversations]);

  const handleNewChat = useCallback(() => {
    setCurrentConversation(null);
  }, []);

  const handleSelectConversation = useCallback(async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleRefreshCurrent = useCallback(async () => {
    if (!currentConversation?.id) return;
    try {
      const conv = await api.getConversation(currentConversation.id);
      setCurrentConversation(conv);
    } catch (e) {
      console.error(e);
    }
  }, [currentConversation?.id]);

  const handleRefreshList = useCallback(() => {
    fetchConversations(searchQuery);
  }, [fetchConversations, searchQuery]);

  const handleDeleteConversation = useCallback(
    async (id) => {
      try {
        await api.deleteConversation(id);
        if (currentConversation?.id === id) {
          setCurrentConversation(null);
        }
        fetchConversations(searchQuery);
      } catch (e) {
        console.error(e);
      }
    },
    [currentConversation?.id, fetchConversations, searchQuery]
  );

  const groups = groupByDate(conversations);

  return (
    <div className="app">
      <Sidebar
        groups={groups}
        activeId={currentConversation?.id ?? null}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
      />
      <div className="app__main">
        <ChatArea
          currentConversation={currentConversation}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          onSendSuccess={handleRefreshCurrent}
          onNewConversationCreated={setCurrentConversation}
          onConversationListChange={handleRefreshList}
        />
      </div>
    </div>
  );
}

export default App;
