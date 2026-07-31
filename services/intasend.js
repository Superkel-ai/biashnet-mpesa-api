const IntaSend = require("intasend-node");

console.log(
  "INTASEND PUBLIC KEY:",
  process.env.INTASEND_PUBLIC_KEY?.substring(0, 20)
);

console.log(
  "INTASEND SECRET KEY:",
  process.env.INTASEND_SECRET_KEY?.substring(0, 20)
);

const intasend = new IntaSend(
  process.env.INTASEND_PUBLIC_KEY,
  process.env.INTASEND_SECRET_KEY,
  false // LIVE mode
);

const collection = intasend.collection();


async function initiatePayment(phone, amount, apiRef) {
  try {

    console.log("Sending IntaSend STK:", {
      phone,
      amount,
      apiRef
    });

    const response = await collection.mpesaStkPush({
      phone_number: phone,
      name: "BIASHNET User",
      email: "payments@biashnet.co.ke",
      amount: Number(amount),
      api_ref: apiRef,
    });


    console.log(
      "INTASEND SUCCESS RESPONSE:",
      JSON.stringify(response, null, 2)
    );


    return response;


  } catch (error) {

    console.error(
      "INTASEND ERROR OBJECT:",
      error
    );

    console.error(
      "INTASEND ERROR STRING:",
      error?.toString()
    );

    throw error;
  }
}


module.exports = {
  initiatePayment,
};