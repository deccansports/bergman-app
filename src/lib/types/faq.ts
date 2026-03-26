
// src/lib/types/faq.ts
export interface Enquiry {
  id: string;
  ticketId: string;
  name: string;
  email: string;
  mobile: string;
  message: string;
  status: 'Open' | 'Replied' | 'Closed' | 'Spam';
  createdAt: string;
  updatedAt: string;
  replies?: EnquiryReply[];
  spamScore?: number;
  isSpam?: boolean;
  ipAddress?: string;
  userAgent?: string;
}

export interface EnquiryReply {
  message: string;
  sentAt: string;
  sentBy: 'User' | 'Admin';
}

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface AiLog {
  id: string;
  userUid: string | null;
  userName: string | null;
  question: string;
  answer: string;
  timestamp: string;
  contextUsed?: string[];
}
