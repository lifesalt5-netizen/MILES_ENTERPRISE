"use strict";

const axios = require("axios");

class CRMClient {

  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async updateDeal(deal) {

    if (!this.apiKey || !this.baseUrl) return;

    return axios.post(
      `${this.baseUrl}/deals`,
      deal,
      {
        headers: {
          Authorization: this.apiKey
        }
      }
    );
  }
}

module.exports = CRMClient;