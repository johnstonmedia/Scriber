# Campaign video — prompts

Two cuts of the same film, aimed at the person who actually signs: a Head of
Learning Support or a Deputy Principal, not a student.

The argument is one they already know and can't currently solve. A student
approved for a writer sits their first real exam having never dictated an
essay under time pressure. They know the content. They lose marks to the
process. The school cannot fix it, because you cannot book a human writer for
weekly practice.

Everything below sells that, and nothing else.

---

## Read this before generating anything

**Do not let a video model draw the interface.** Generative video renders
plausible-looking UI with garbled text, and a school audience reads that as
fake instantly. Generate the room, the people and the light with the model;
composite real screen recordings from the actual product over the monitors in
post. `npm run store:shots` already does this for stills — the same approach
with a screen recorder gives you honest footage.

**Two rules that are not negotiable.**

No phone, tablet, or any handheld device may appear in a single frame.
Scriber is desktop-only today, and showing a phone promises something that
does not exist. Laptops and desktop monitors only.

No NESA logo, wordmark, or anything implying endorsement. Scriber is an
independent practice tool. The site says so in its footer and the video must
not contradict it.

---

## Style block — prepend to every shot

```
Documentary-realistic, unstyled. Australian secondary school, present day, mid-morning.
Natural window light, slightly overcast — soft, cool, no golden hour, no lens flare.
Shot on a full-frame camera, 35mm and 50mm primes, shallow but not showy depth of field.
Handheld with almost no movement: the weight of a real camera, not a gimbal glide.
Muted, true-to-life colour. Palette leans deep blue #1F5FD8, off-white #F6F7F9,
near-black ink #10151C. Nothing saturated, nothing teal-and-orange.
Real teenagers and real staff, varied appearance and body types, ordinary uniforms,
no makeup-perfect faces, no stock-photo smiles. People concentrating, not performing.
Rooms are lived-in: scuffed desks, a whiteboard half-wiped, stacked chairs.
Sound design bias: room tone, a clock, a chair scrape. No music bed under dialogue.
```

## Negative prompt — every shot

```
phone, smartphone, mobile phone, tablet, iPad, handheld device, someone holding a device,
app store badge, mobile UI, portrait phone mockup,
NESA logo, exam board branding, official crest, government seal,
stock-photo smiling, thumbs up, high-five, cheering, slow-motion celebration,
teal and orange grade, lens flare, light leaks, drone shot, time-lapse,
garbled text, gibberish letterforms, fake dashboard, unreadable UI,
AI-perfect skin, uncanny faces, extra fingers, warped hands,
crowded stock office, generic corporate meeting, whiteboard covered in fake charts
```

---

# Cut A — 16:9 master (75 seconds)

For the website, the demo page, and the email you send a Head of Learning
Support. Landscape, 1920×1080, 24fps.

### Shot 1 — 0:00–0:07 · the problem, stated without words

```
[STYLE BLOCK]
A quiet school hall set up for exams. Rows of single desks, wide spacing.
One student, 17, sits at a desk beside an adult writer who holds a pen over a
booklet. The student is mid-sentence, one hand raised slightly, stopping.
The writer's pen is still. Neither is panicking; both are waiting.
Push in very slowly on the gap between the student's mouth and the still pen.
50mm, shallow focus on the pen, the student soft behind it.
```

**On screen** (Newsreader, off-white on near-black, lower third, fades in at 0:03):
`Approved for a writer.`

**VO:** *Every year, students are approved to sit their exams with a writer. Someone who writes down exactly what they say.*

### Shot 2 — 0:07–0:15 · name the gap

```
[STYLE BLOCK]
Same hall, wider. The student starts again, speaking faster now, gesturing.
The writer's pen moves, then pauses, then the writer turns and asks something
short. The student's shoulders drop — not despair, just the small deflation of
losing your thread. Static 35mm, no push.
```

**On screen:** `Most use it for the first time on the day that counts.`

**VO:** *It is the fairest thing a school can offer. It is also a skill — and almost nobody gets to practise it.*

### Shot 3 — 0:15–0:26 · the insight

```
[STYLE BLOCK]
Cut to an empty classroom after hours. A learning support teacher, 40s,
sits alone at a desk with a laptop open, marking. She stops, looks at
the middle distance, thinking. Late light through venetian blinds.
Slow 35mm handheld, framed with the room's emptiness to her left.
```

**On screen:** `Dictating an essay is nothing like writing one.`

**VO:** *You have to say your own punctuation. You have to pace someone else's hand. You have to hear your argument out loud and keep going anyway. None of that is on the syllabus, and none of it can be learned on the day.*

### Shot 4 — 0:26–0:38 · the product, shown honestly

```
[STYLE BLOCK]
The same student, now at home or in a study room, at a LAPTOP — no phone
anywhere in frame. Speaking steadily to the screen, glancing at a printed past
paper propped beside the keyboard. Over-shoulder, 50mm, the screen visible but
soft — the composited screen recording carries the detail.
The student pauses mid-clause, listens, then repeats a word more slowly.
```

**Composite over screen:** real Scriber exam room. Words landing a beat behind the voice, the writer asking how to spell a name, the answer sheet filling.

**On screen:** `Scriber is the writer. Available every day.`

**VO:** *Scriber writes exactly what is said and nothing more. It lags a beat behind. It holds only so much. It asks how to spell a word it does not know — because a real writer does.*

### Shot 5 — 0:38–0:52 · the school's side, the actual sale

```
[STYLE BLOCK]
A learning support office. Two staff at a DESKTOP MONITOR, one seated one
standing, discussing something on screen and pointing. Unhurried, competent.
Behind them a wall of ring binders and a printed class list.
Static 35mm, slight over-shoulder so the monitor is legible.
```

**Composite over monitor:** the real supervisor monitor — students listed, live word counts, one row showing another site open, one showing tabs not monitored.

**On screen, three beats cut on the VO:**
`Distribute past papers.` → `Run the whole class on one clock.` → `See who has opened something else.`

**VO:** *For your team: send past papers to the students who need them. Run a supervised trial with the whole class on one clock. See who is logged on, who is sharing their screen, and who has opened another tab.*

### Shot 6 — 0:52–1:02 · the detail that wins the room

```
[STYLE BLOCK]
Close on a printer pushing out a stack of exam papers into a tray, then a
teacher's hands squaring the stack on a desk beside a pile of handwritten
booklets. The printed cover shows a number, not a name.
Macro-ish 50mm, shallow, natural desk light.
```

**On screen:** `Marked under an exam number, not a name.`

**VO:** *And it prints for your markers the way senior work is meant to be marked — under an exam number, in the same stack as everyone else's.*

### Shot 7 — 1:02–1:15 · close

```
[STYLE BLOCK]
Back to the exam hall from Shot 1, now mid-exam and full. The same student,
composed, dictating steadily. The writer's pen keeps up. No triumph, no
music swell — just someone doing a thing they have done before.
Hold, then let the frame settle to stillness.
```

**End card** (2.5s, near-black #10151C, off-white Newsreader, the comma-on-a-ruled-line mark above):

```
Scriber
Practise with a writer before the exam room does.

Demo for five students · pracscriber.com
```

**VO:** *Scriber. Practise with a writer before the exam room does.*

---

# Cut B — 9:16 vertical (25 seconds)

For LinkedIn, staff-room shares, and conference screens. 1080×1920, 24fps.
Same world, one argument, no VO — most of this plays muted, so the text
carries it. Type is large and sits in the middle third, clear of platform UI
top and bottom.

### Shot 1 — 0:00–0:05

```
[STYLE BLOCK — vertical framing]
Vertical composition. A single exam desk in a wide hall, shot from front-on,
student seated small in the lower third, ceiling and empty space above.
An adult writer beside them, pen poised and still.
Static 35mm. Almost no movement. Room tone only.
```

**On screen, large, centre:** `Your students get a writer in the exam.`

### Shot 2 — 0:05–0:10

```
[STYLE BLOCK — vertical framing]
Push slowly to a tight vertical portrait of the student mid-sentence,
faltering — mouth open, eyes moving, hand half-raised. Hold on the hesitation.
50mm, shallow.
```

**On screen:** `Almost none of them have practised using one.`

### Shot 3 — 0:10–0:17

```
[STYLE BLOCK — vertical framing]
Cut to the same student at a LAPTOP in a study room — no phone in frame at any
point. Vertical framing puts the laptop screen in the upper-middle third,
the student's face and shoulders below it.
They speak; they pause; they repeat a word more slowly; they carry on.
```

**Composite over screen:** the real answer sheet filling a beat behind the voice.

**On screen:** `Now they can.`
**Then:** `Scriber is the writer — the lag, the limited memory, the "how do you spell that?"`

### Shot 4 — 0:17–0:22

```
[STYLE BLOCK — vertical framing]
Two learning support staff at a desktop monitor, vertical crop favouring
the screen and one face. They point at something and one nods.
```

**Composite over monitor:** the supervisor view with a live class list.

**On screen:** `Run a supervised trial for the whole class. On one clock.`

### Shot 5 — 0:22–0:25 · end card

Near-black #10151C, comma mark, off-white Newsreader:

```
Scriber

Free demo — up to 5 students
pracscriber.com
```

---

## If you only make one thing

Cut Shot 2 and Shot 4 of the vertical together as a 10-second loop with the two
text cards. The hesitation, then the practice. That is the entire pitch, and it
works with the sound off.

## Claims you can make, and one you cannot

Safe, because the product does them: writes only what is dictated; a
deliberate lag and limited memory; asks how to spell; distributes past papers;
runs a synchronised supervised test; shows screen sharing and other open tabs;
takes a roll; prints under exam numbers; free demo for five students; seat
tiers to 150.

**Do not claim** that Scriber is endorsed by, aligned to, or approved by NESA,
and do not claim it replaces the writer a student is approved to work with.
Both are false and the site's own footer says the opposite.
