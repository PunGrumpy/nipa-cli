---
"nipa-cli": minor
---

`nipa login` sends your password first and asks for an OTP code only when Keystone asks for one. After a wrong code, it asks for the next one, up to 3 times, without asking for the password again.
