"""Telegram integration via Telethon (user session, MTProto).

A user session — not a bot — is used so private channels the user is a member
of can be read. Login happens through the UI: phone -> code -> (optional 2FA
password). The session is persisted to data/telegram.session so subsequent
starts reconnect silently.
"""
import asyncio
import logging
from typing import Callable, Awaitable

from telethon import TelegramClient, events
from telethon.errors import SessionPasswordNeededError

from .paths import TELEGRAM_SESSION
from . import settings_store

log = logging.getLogger("autoapply.telegram")


class TelegramManager:
    def __init__(self):
        self.client: TelegramClient | None = None
        self.state = "disconnected"  # disconnected | awaiting_code | awaiting_password | connected | error
        self.error: str | None = None
        self.phone: str | None = None
        self._phone_code_hash: str | None = None
        self._handler_registered = False
        self._ingest: Callable[[str, str], Awaitable[None]] | None = None

    def set_ingest_callback(self, cb: Callable[[str, str], Awaitable[None]]):
        self._ingest = cb

    def status(self) -> dict:
        watched = settings_store.load()["telegram"].get("watched_chats", [])
        return {"state": self.state, "error": self.error,
                "watched_chats": watched}

    async def _ensure_client(self) -> TelegramClient:
        cfg = settings_store.load()["telegram"]
        api_id = str(cfg.get("api_id") or "").strip()
        api_hash = str(cfg.get("api_hash") or "").strip()
        if not api_id or not api_hash:
            raise ValueError("Telegram api_id / api_hash are not set. Get them from my.telegram.org and save in Settings.")
        if self.client is None:
            self.client = TelegramClient(TELEGRAM_SESSION, int(api_id), api_hash)
        if not self.client.is_connected():
            await self.client.connect()
        return self.client

    async def connect(self) -> dict:
        """Connect; if the saved session is authorized start listening,
        otherwise send a login code to the configured phone."""
        self.error = None
        try:
            client = await self._ensure_client()
            if await client.is_user_authorized():
                await self._on_authorized()
                return self.status()
            cfg = settings_store.load()["telegram"]
            phone = str(cfg.get("phone") or "").strip()
            if not phone:
                raise ValueError("Telegram phone number is not set in Settings.")
            self.phone = phone
            sent = await client.send_code_request(phone)
            self._phone_code_hash = sent.phone_code_hash
            self.state = "awaiting_code"
        except Exception as e:
            self.state = "error"
            self.error = str(e)
        return self.status()

    async def submit_code(self, code: str) -> dict:
        self.error = None
        try:
            client = await self._ensure_client()
            try:
                await client.sign_in(phone=self.phone, code=code.strip(),
                                     phone_code_hash=self._phone_code_hash)
            except SessionPasswordNeededError:
                self.state = "awaiting_password"
                return self.status()
            await self._on_authorized()
        except Exception as e:
            self.state = "error"
            self.error = str(e)
        return self.status()

    async def submit_password(self, password: str) -> dict:
        self.error = None
        try:
            client = await self._ensure_client()
            await client.sign_in(password=password)
            await self._on_authorized()
        except Exception as e:
            self.state = "error"
            self.error = str(e)
        return self.status()

    async def _on_authorized(self):
        self.state = "connected"
        self._register_handler()
        log.info("Telegram connected, listener active")

    def _register_handler(self):
        if self._handler_registered or self.client is None:
            return

        @self.client.on(events.NewMessage())
        async def _on_message(event):
            try:
                watched = settings_store.load()["telegram"].get("watched_chats", [])
                watched_ids = {int(c["id"]) for c in watched}
                if watched_ids and event.chat_id not in watched_ids:
                    return
                if not watched_ids:
                    return  # nothing selected -> ignore everything
                text = event.message.message or ""
                if not text.strip():
                    return
                chat = await event.get_chat()
                title = getattr(chat, "title", None) or getattr(chat, "username", "") or str(event.chat_id)
                if self._ingest:
                    await self._ingest(text, title)
            except Exception:
                log.exception("Failed handling incoming telegram message")

        self._handler_registered = True

    async def list_chats(self) -> list[dict]:
        client = await self._ensure_client()
        if not await client.is_user_authorized():
            raise ValueError("Telegram is not connected yet.")
        chats = []
        async for dialog in client.iter_dialogs(limit=300):
            if dialog.is_channel or dialog.is_group:
                chats.append({"id": dialog.id, "title": dialog.title})
        return chats

    async def disconnect(self) -> dict:
        if self.client is not None:
            try:
                await self.client.disconnect()
            except Exception:
                pass
        self.client = None
        self._handler_registered = False
        self.state = "disconnected"
        self.error = None
        return self.status()

    async def try_autostart(self):
        """On server boot, silently reconnect if a valid session exists."""
        cfg = settings_store.load()["telegram"]
        if not (cfg.get("api_id") and cfg.get("api_hash")):
            return
        try:
            client = await self._ensure_client()
            if await client.is_user_authorized():
                await self._on_authorized()
            else:
                await client.disconnect()
                self.client = None
        except Exception as e:
            log.warning("Telegram autostart skipped: %s", e)


manager = TelegramManager()
