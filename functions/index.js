const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const SCHOOL_EMAIL_DOMAIN = "edu.burnabyschools.ca";

/**
 * Runs every day at 6:00 PM America/Vancouver time.
 * Looks at every active borrow in the "borrows" collection and, for any item
 * whose due date falls within the next 24 hours, emails the borrower a
 * reminder using their school email (studentId@edu.burnabyschools.ca).
 *
 * Uses a `reminderSent` flag on each borrow doc so nobody gets emailed twice.
 */
exports.sendDueTomorrowReminders = onSchedule(
    {
        schedule: "0 18 * * *",
        timeZone: "America/Vancouver",
    },
    async () => {
        const now = new Date();
        const snapshot = await db.collection("borrows").get();

        const writes = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();

            if (data.reminderSent) return;
            if (!data.dueDate || !data.studentId) return;

            const dueDate = new Date(data.dueDate);
            const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);

            // Item is due within the next 24 hours (i.e. due "tomorrow")
            if (hoursUntilDue > 0 && hoursUntilDue <= 24) {
                const studentEmail = `${data.studentId}@${SCHOOL_EMAIL_DOMAIN}`;
                const dueDateFormatted = dueDate.toLocaleDateString("en-US", {
                    timeZone: "America/Vancouver",
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                });

                // Writing to the "mail" collection is what the "Trigger Email" Firebase
                // Extension watches. It will pick this doc up and actually send it.
                const mailTask = db
                    .collection("mail")
                    .add({
                        to: studentEmail,
                        message: {
                            subject: `Reminder: Cube "${docSnap.id}" is due back tomorrow`,
                            text:
                                `Hi ${data.name},\n\n` +
                                `This is a friendly reminder that the cube you borrowed from the ` +
                                `BMSS Rubik's Cube Club Library (Item ${docSnap.id}) is due back ` +
                                `on ${dueDateFormatted}.\n\n` +
                                `Please return it on time. If you've already returned it, you can ` +
                                `disregard this message.\n\n` +
                                `Thanks,\nBMSS Rubik's Cube Club`,
                        },
                    })
                    .then(() => docSnap.ref.update({ reminderSent: true }));

                writes.push(mailTask);
            }
        });

        await Promise.all(writes);
        console.log(`Reminder check complete. Emails queued: ${writes.length}`);
    }
);