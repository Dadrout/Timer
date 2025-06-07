'use client';

import { useState, useEffect } from 'react';
import Image from "next/image";

const motivationalPhrases = [
  "Ты справился! 💪",
  "Отличная работа! 🌟",
  "Ты молодец! 🎉",
  "Продолжай в том же духе! ⭐",
  "Ты на правильном пути! 🚀"
];

export default function Timer() {
  const [name, setName] = useState('');
  const [timeLeft, setTimeLeft] = useState(10);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [completionCount, setCompletionCount] = useState(0);
  const [selectedTime, setSelectedTime] = useState(10);
  const [motivationalPhrase, setMotivationalPhrase] = useState('');

  // Load name from localStorage on component mount
  useEffect(() => {
    const savedName = localStorage.getItem('timerName');
    if (savedName) {
      setName(savedName);
    }
  }, []);

  // Save name to localStorage when it changes
  useEffect(() => {
    if (name) {
      localStorage.setItem('timerName', name);
    }
  }, [name]);

  useEffect(() => {
    let interval;
    if (isRunning && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isRunning) {
      setIsRunning(false);
      setIsComplete(true);
      setCompletionCount((prev) => prev + 1);
      setMotivationalPhrase(motivationalPhrases[Math.floor(Math.random() * motivationalPhrases.length)]);
    }
    return () => clearInterval(interval);
  }, [isRunning, timeLeft]);

  const handleStart = () => {
    setTimeLeft(selectedTime);
    setIsRunning(true);
    setIsComplete(false);
  };

  const handleReset = () => {
    setTimeLeft(selectedTime);
    setIsRunning(false);
    setIsComplete(false);
  };

  const progress = ((selectedTime - timeLeft) / selectedTime) * 100;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-96">
        <h1 className="text-2xl font-bold mb-6 text-center">Таймер-Мотиватор</h1>
        
        <div className="mb-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Введите ваше имя"
            className="w-full p-2 border rounded"
            disabled={isRunning}
          />
        </div>

        <div className="mb-4">
          <select
            value={selectedTime}
            onChange={(e) => setSelectedTime(Number(e.target.value))}
            className="w-full p-2 border rounded"
            disabled={isRunning}
          >
            <option value={10}>10 секунд</option>
            <option value={20}>20 секунд</option>
            <option value={30}>30 секунд</option>
          </select>
        </div>

        {isRunning && (
          <div className="mb-4">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-1000"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className="text-center mt-2">
              {name}, осталось {timeLeft} сек
            </p>
          </div>
        )}

        {isComplete && (
          <div className="mb-4 text-center text-green-600 font-bold">
            {motivationalPhrase}, {name}!
          </div>
        )}

        <div className="flex gap-2 justify-center">
          <button
            onClick={handleStart}
            disabled={isRunning || !name}
            className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-300"
          >
            Старт таймера
          </button>
          <button
            onClick={handleReset}
            className="bg-gray-500 text-white px-4 py-2 rounded"
          >
            Сброс
          </button>
        </div>

        <div className="mt-4 text-center text-gray-600">
          Завершено раз: {completionCount}
        </div>
      </div>
    </div>
  );
}
