# Canvas Quiz Auto-Solver (Random/Brute-Force)

[🇻🇳 Tiếng Việt (Vietnamese Guide)](./README_VN.md)

A robust Userscript designed to automatically solve Canvas quizzes using a "Trial and Error" (Brute-Force) memory approach. It requires **NO AI API keys** and improves its accuracy over time by "harvesting" correct answers from your past attempts.

## 🚀 Features

*   **Zero Config**: No Gemini/OpenAI API keys needed.
*   **Memory System**: Remembers correct answers and excludes wrong answers based on text content.
*   **Random Pick**: Automatically selects a random option for unknown questions (excluding known wrong ones).
*   **Harvest Mode**: Scans the quiz review/result page to learn from mistakes.
*   **Auto-Submit**: Automatically submits the quiz when all questions are answered.
*   **Resilience**: Works through page reloads and network hiccups.

## 📥 Installation

1.  Install a Userscript manager extension:
    *   [Tampermonkey](https://www.tampermonkey.net/) (Recommended)
    *   Violentmonkey
2.  Create a new script in your manager.
3.  Copy the entire content of `main.js`.
4.  Paste it into the editor and save (Ctrl+S).

## 🎮 How to Use

### Phase 1: Taking the Quiz
1.  Navigate to your Canvas Quiz page.
2.  You will see a control panel in the bottom-right corner.
3.  **#Q**: Set the total number of questions to answer.
4.  **Delay(s)**: Set the delay between questions (recommended 2-4 seconds to avoid detection/errors).
5.  Click **"🤖 Start Loop"**.
6.  The script will:
    *   Pick the correct answer if known.
    *   Pick a random answer if unknown (excluding previously known wrong answers).
    *   Automatically move to the next question.
    *   **Auto-Submit** when finished.

### Phase 2: Learning (The most important step!)
1.  After submitting, open the **Submission Details** or **Review** page where the correct/incorrect answers are shown.
2.  Click the **"📥 Harvest Q/A"** button on the panel.
3.  The script will analyze the page and save:
    *   **Right answers**: To select immediately next time.
    *   **Wrong answers**: To never pick again.
4.  Repeat the quiz! The accuracy will increase with every attempt until it reaches 100%.

## ⚙️ Controls

*   **Start Loop**: Begin the auto-answering process.
*   **Stop**: Pause the script.
*   **Harvest Q/A**: Click this ON THE REVIEW PAGE to simple the "brain".
*   **Delete data**: Clear all learned answers (Memory Reset).
*   **Auto-Submit**: Enabled by default when the question counter reaches 0.

## ⚠️ Note
*   This method relies on "Trial and Error". The first few attempts will have low scores (random guessing).
*   Always check "Harvest" after every attempt to improve future performance.
