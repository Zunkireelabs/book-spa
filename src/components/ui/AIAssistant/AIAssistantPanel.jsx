import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../AppIcon';
import { useAIAssistant } from '../../../contexts/AIAssistantContext';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import TypingIndicator from './TypingIndicator';

// Mock responses for BooX domain
const getMockResponse = (message) => {
  const lowerMessage = message.toLowerCase();

  // Greetings
  if (['hello', 'hi', 'hey'].some(g => lowerMessage.includes(g))) {
    return "Hi! I'm your AI assistant. I can help you with:\n\n• Finding and managing bookings\n• Understanding your revenue\n• Checking therapist availability\n• Answering questions about BooX\n\nHow can I help you today?";
  }

  // Bookings
  if (['booking', 'appointment', 'reservation'].some(k => lowerMessage.includes(k))) {
    return "Based on your booking data, I can help you:\n\n• View today's appointments\n• Check pending bookings that need confirmation\n• Find bookings by customer name or phone\n• See upcoming schedule\n\nWhat would you like to know about your bookings?";
  }

  // Revenue
  if (['revenue', 'money', 'income', 'earnings', 'paid'].some(k => lowerMessage.includes(k))) {
    return "I can provide insights on your revenue:\n\n• Today's collections from paid bookings\n• Comparison with yesterday and last week\n• Average revenue per booking\n• Top performing services\n\nWould you like me to analyze any specific period?";
  }

  // Therapists / Staff
  if (['therapist', 'staff', 'employee', 'team'].some(k => lowerMessage.includes(k))) {
    return "For therapist and staff management, I can help with:\n\n• Checking therapist availability\n• Viewing utilization rates\n• Seeing who's assigned to upcoming bookings\n• Finding available slots for a specific therapist\n\nWhat do you need to know about your team?";
  }

  // Schedule / Calendar
  if (['schedule', 'calendar', 'today', 'tomorrow', 'week'].some(k => lowerMessage.includes(k))) {
    return "I can help you understand your schedule:\n\n• View appointments for any date\n• Check peak hours and busy times\n• See room utilization\n• Find available time slots\n\nWhich date or time period are you interested in?";
  }

  // Help
  if (['help', 'what can you', 'how do'].some(k => lowerMessage.includes(k))) {
    return "I'm here to help you manage BooX more efficiently! I can assist with:\n\n• **Bookings** - Find, filter, and understand appointment data\n• **Revenue** - Analyze earnings and financial insights\n• **Staff** - Check therapist availability and performance\n• **Schedule** - View calendar and find open slots\n• **Reports** - Summarize daily operations\n\nJust ask me anything in natural language!";
  }

  // Thank you
  if (['thank', 'thanks', 'thx'].some(k => lowerMessage.includes(k))) {
    return "You're welcome! Feel free to ask if you need anything else. I'm always here to help you manage your spa efficiently.";
  }

  // Default
  return "I understand you're asking about your spa operations. I can help with bookings, revenue, therapist schedules, and more.\n\nCould you be more specific about what you'd like to know? For example:\n• \"Show me today's bookings\"\n• \"How is revenue this week?\"\n• \"Which therapists are available?\"";
};

const AIAssistantPanel = () => {
  const { isOpen, closeAssistant } = useAIAssistant();
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hi! I'm your AI assistant. I can help you with:\n\n• Finding and managing bookings\n• Understanding your revenue\n• Answering questions about your spa\n\nHow can I help you today?",
      timestamp: new Date(),
    },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef(null);

  const panelWidth = isExpanded ? 600 : 420;

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSendMessage = async (content) => {
    // Add user message
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);

    // Simulate API delay (300-800ms)
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));

    // Get mock response
    const responseContent = getMockResponse(content);

    const assistantMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: responseContent,
      timestamp: new Date(),
    };

    setIsTyping(false);
    setMessages(prev => [...prev, assistantMessage]);
  };

  return (
    <div
      className={`h-full transition-all duration-500 ease-out overflow-hidden ${
        isOpen ? 'opacity-100' : 'w-0 opacity-0'
      }`}
      style={{ width: isOpen ? panelWidth : 0 }}
    >
      <div
        className={`h-full bg-white rounded-xl border border-gray-200 shadow-lg flex flex-col transition-transform duration-500 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-8'
        }`}
        style={{ width: panelWidth }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-pink-50 rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Icon name="Sparkles" size={16} className="text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">AI Assistant</h3>
              <p className="text-xs text-gray-500">Powered by BooX AI</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              <Icon
                name={isExpanded ? 'Minimize2' : 'Maximize2'}
                size={16}
                className="text-gray-500"
              />
            </button>
            <button
              onClick={closeAssistant}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <Icon name="X" size={16} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {messages.map(message => (
            <ChatMessage key={message.id} message={message} />
          ))}
          {isTyping && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <ChatInput onSend={handleSendMessage} disabled={isTyping} />

        {/* Footer Disclaimer */}
        <div className="px-4 pb-3">
          <p className="text-xs text-gray-400 text-center">
            AI-generated content may be inaccurate. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AIAssistantPanel;
