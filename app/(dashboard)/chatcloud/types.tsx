
export interface Message {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ChatChannel {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
  unreadCount?: number;
  category: 'General' | 'Engineering' | 'Analytics' | 'Support';
}