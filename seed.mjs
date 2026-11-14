export const PUBLIC_BOARD_URL = "https://api.npoint.io/9368c24b508a2bf76c66";

const SEED = {
  "people": [
    {
      "id": "left",
      "name": "Teegan",
      "timezone": "Europe/Dublin",
      "days": [
        {
          "id": "monday",
          "blocks": [
            {
              "id": "mon-school",
              "title": "School",
              "start": "08:50",
              "end": "15:45",
              "note": ""
            },
            {
              "id": "mon-volley",
              "title": "Volleyball",
              "start": "16:00",
              "end": "17:00",
              "note": ""
            },
            {
              "id": "mon-irish",
              "title": "Irish dancing",
              "start": "17:45",
              "end": "19:45",
              "note": ""
            },
            {
              "id": "mon-evening",
              "title": "Eat, chill, and sleep",
              "start": "19:45",
              "end": "",
              "note": "The rest of the night"
            }
          ]
        },
        {
          "id": "tuesday",
          "blocks": [
            {
              "id": "tue-school",
              "title": "School",
              "start": "08:50",
              "end": "15:45",
              "note": ""
            },
            {
              "id": "tue-athlone",
              "title": "Athlone",
              "start": "15:45",
              "end": "19:00",
              "note": "After school"
            },
            {
              "id": "tue-night",
              "title": "Panto or youth band",
              "start": "19:00",
              "end": "",
              "note": "One or the other"
            }
          ]
        },
        {
          "id": "wednesday",
          "blocks": [
            {
              "id": "wed-school",
              "title": "School",
              "start": "08:50",
              "end": "15:45",
              "note": ""
            },
            {
              "id": "wed-free",
              "title": "Nothing on",
              "start": "15:45",
              "end": "",
              "note": "No plans after school"
            }
          ]
        },
        {
          "id": "thursday",
          "blocks": [
            {
              "id": "thu-school",
              "title": "School",
              "start": "08:50",
              "end": "15:45",
              "note": ""
            },
            {
              "id": "thu-irish",
              "title": "Irish dancing",
              "start": "19:00",
              "end": "20:30",
              "note": ""
            }
          ]
        },
        {
          "id": "friday",
          "blocks": [
            {
              "id": "fri-school",
              "title": "School",
              "start": "08:50",
              "end": "15:45",
              "note": "Usual hours"
            },
            {
              "id": "fri-art",
              "title": "Art club",
              "start": "14:00",
              "end": "15:30",
              "note": "She called this after school"
            },
            {
              "id": "fri-panto",
              "title": "Panto",
              "start": "20:00",
              "end": "21:00",
              "note": ""
            }
          ]
        },
        {
          "id": "saturday",
          "blocks": [
            {
              "id": "sat-dance",
              "title": "Dancing",
              "start": "14:45",
              "end": "16:30",
              "note": ""
            }
          ]
        },
        {
          "id": "sunday",
          "blocks": [
            {
              "id": "sun-free",
              "title": "Free",
              "start": "",
              "end": "",
              "note": "Sometimes panto"
            }
          ]
        }
      ]
    },
    {
      "id": "right",
      "name": "Luca",
      "timezone": "",
      "days": [
        {
          "id": "monday",
          "blocks": [
            {
              "id": "mon-school",
              "title": "School",
              "start": "07:50",
              "end": "15:00",
              "note": ""
            },
            {
              "id": "mon-ball",
              "title": "Basketball",
              "start": "18:00",
              "end": "19:30",
              "note": ""
            }
          ]
        },
        {
          "id": "tuesday",
          "blocks": [
            {
              "id": "tue-school",
              "title": "School",
              "start": "07:50",
              "end": "13:50",
              "note": ""
            },
            {
              "id": "tue-ball",
              "title": "Basketball",
              "start": "20:00",
              "end": "21:30",
              "note": ""
            }
          ]
        },
        {
          "id": "wednesday",
          "blocks": [
            {
              "id": "wed-school",
              "title": "School",
              "start": "07:50",
              "end": "13:50",
              "note": ""
            },
            {
              "id": "wed-free",
              "title": "Nothing on",
              "start": "13:50",
              "end": "",
              "note": "No plans after school"
            }
          ]
        },
        {
          "id": "thursday",
          "blocks": [
            {
              "id": "thu-school",
              "title": "School",
              "start": "07:50",
              "end": "17:10",
              "note": ""
            }
          ]
        },
        {
          "id": "friday",
          "blocks": [
            {
              "id": "fri-school",
              "title": "School",
              "start": "07:50",
              "end": "13:50",
              "note": ""
            },
            {
              "id": "fri-ball",
              "title": "Basketball",
              "start": "18:30",
              "end": "20:00",
              "note": ""
            }
          ]
        },
        {
          "id": "saturday",
          "blocks": []
        },
        {
          "id": "sunday",
          "blocks": []
        }
      ]
    }
  ],
  "calls": [],
  "visit": {
    "date": "",
    "place": ""
  },
  "strokes": []
};

export function freshSeed() {
  return structuredClone(SEED);
}
