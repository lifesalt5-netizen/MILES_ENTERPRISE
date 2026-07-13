"use strict";

const axios = require("axios");

class InstantlyClient {

  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async sendEmail(to, subject, body) {

    if (!this.apiKey) return;

    return axios.post(
      "https://api.instantly.ai/api/v1/email/send",
      { to, subject, body },
      {
        headers: {
          Authorization: this.apiKey
        }
      }
    );
  }
}

module.exports = InstantlyClient;