const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const password = process.env.SMOKE_HOST_PASSWORD;

if (!password) {
  throw new Error("SMOKE_HOST_PASSWORD is required");
}

let cookie = "";
let roomCode;
let quizId;

async function request(path, method = "GET", body, token) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie && !token) headers.Cookie = cookie;
  if (token) headers["X-Player-Token"] = token;

  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function expect(condition, label, result) {
  if (!condition) {
    throw new Error(`${label}: ${JSON.stringify(result)}`);
  }
  console.log(`PASS ${label}`);
}

try {
  let result = await request("/api/host/login", "POST", { username: "ming", password });
  expect(result.status === 200, "host login", result);

  result = await request("/api/quizzes", "POST", {
    title: "자동 점검용 퀴즈",
    questions: [
      { kind: "ox", prompt: "첫 문제", options: ["O", "X"], correctAnswers: ["O"], explanation: "O입니다" },
      { kind: "short", prompt: "대한민국 수도", correctAnswers: ["서울"] },
    ],
  });
  expect(result.status === 201, "save quiz", result);
  quizId = result.data.quiz.id;

  result = await request("/api/rooms", "POST", { quizId });
  expect(result.status === 201, "create room", result);
  roomCode = result.data.code;

  const players = [];
  for (const nickname of ["가람", "가람", "다온"]) {
    result = await request(`/api/rooms/${roomCode}/join`, "POST", { nickname });
    expect(result.status === 200, `join ${nickname}`, result);
    players.push(result.data);
  }
  expect(players[0].nickname !== players[1].nickname, "duplicate nickname disambiguated", players);

  result = await request(`/api/rooms/${roomCode}/start`, "POST");
  expect(result.status === 200, "start room", result);

  result = await request(`/api/rooms/${roomCode}/join`, "POST", { nickname: "늦은 참가" });
  expect(result.status >= 400, "late join rejected", result);

  const anonymous = await fetch(new URL(`/api/rooms/${roomCode}/state`, baseUrl));
  expect(anonymous.status === 401, "anonymous state rejected", anonymous.status);
  const anonymousQuizzes = await fetch(new URL("/api/quizzes", baseUrl));
  expect(anonymousQuizzes.status === 401, "anonymous host API rejected", anonymousQuizzes.status);
  const display = await fetch(new URL(`/api/rooms/${roomCode}/state?view=display`, baseUrl));
  const displayState = await display.json();
  expect(
    display.status === 200 &&
      !("correctAnswers" in displayState.currentQuestion) &&
      !("explanation" in displayState.currentQuestion) &&
      displayState.quiz.questions.length === 0 &&
      displayState.answers.length === 0,
    "public display is sanitized",
    displayState,
  );

  result = await request(`/api/rooms/${roomCode}/state`, "GET", undefined, players[0].token);
  expect(result.status === 200 && !("correctAnswers" in result.data.currentQuestion) && !("explanation" in result.data.currentQuestion), "answer hidden before reveal", result);

  result = await request(`/api/rooms/${roomCode}/answer`, "POST", { answer: "X" }, players[0].token);
  expect(result.status === 200, "initial answer", result);
  result = await request(`/api/rooms/${roomCode}/answer`, "POST", { answer: "O" }, players[0].token);
  expect(result.status === 200, "answer change before close", result);
  result = await request(`/api/rooms/${roomCode}/answer`, "POST", { answer: "X" }, players[1].token);
  expect(result.status === 200, "second player answer", result);

  result = await request(`/api/rooms/${roomCode}/close`, "POST");
  expect(result.status === 200, "close answers", result);
  result = await request(`/api/rooms/${roomCode}/answer`, "POST", { answer: "O" }, players[2].token);
  expect(result.status >= 400, "late answer rejected", result);

  result = await request(`/api/rooms/${roomCode}/grade`, "POST", { participantId: players[1].participantId, correct: true });
  expect(result.status === 200, "host grading override", result);
  result = await request(`/api/rooms/${roomCode}/reveal`, "POST");
  expect(result.status === 200, "reveal answer", result);
  result = await request(`/api/rooms/${roomCode}/state`, "GET", undefined, players[0].token);
  expect(result.data.currentQuestion.correctAnswers?.[0] === "O", "answer shown after reveal", result);
  expect(result.data.participants.find((player) => player.id === players[2].participantId)?.status === "eliminated", "nonrespondent eliminated", result);

  result = await request(`/api/rooms/${roomCode}/next`, "POST");
  expect(result.status === 200 && result.data.phase === "question", "advance to next", result);
  result = await request(`/api/rooms/${roomCode}/answer`, "POST", { answer: "서울" }, players[0].token);
  expect(result.status === 200, "short answer", result);
  result = await request(`/api/rooms/${roomCode}/answer`, "POST", { answer: "부산" }, players[1].token);
  expect(result.status === 200, "wrong short answer", result);
  result = await request(`/api/rooms/${roomCode}/close`, "POST");
  expect(result.status === 200, "close second round", result);
  result = await request(`/api/rooms/${roomCode}/reveal`, "POST");
  expect(result.status === 200 && result.data.phase === "finished" && result.data.winner?.id === players[0].participantId, "single winner selected", result);
} finally {
  if (roomCode) await request(`/api/rooms/${roomCode}`, "DELETE");
  if (quizId) await request(`/api/quizzes/${quizId}`, "DELETE");
}
