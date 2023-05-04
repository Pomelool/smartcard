import "./imageUploadForm.css";
import React, { useState } from "react";
import { SMARTButton } from "../../button/button";
import axios from "axios";

const ImageUploadForm = ({ closePopup, images, onImageChange, setDeck }) => {

  const [inputs, setInputs] = useState({});
  const [isChecked, setIsChecked] = useState(false);
  const [isChecked2, setIsChecked2] = useState(false);


  const handleChange = (event) => {
    const name = event.target.name;
    const value = event.target.value;
    setInputs((values) => ({ ...values, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const formData = new FormData();
    formData.append("image", images[0]);
    formData.append("cardsAcross", inputs.numAcross);
    formData.append("cardsDown", inputs.numDown);
    formData.append("totalCards", inputs.numTotal);
    formData.append("hasSameBack", isChecked);
    formData.append("isLandscape", isChecked2);

    // todo: move to constant
    const url =
      process.env.NODE_ENV === "production"
        ? "https://smartgamesandbox.herokuapp.com"
        : "http://localhost:8000";

    axios
      .post(`${url}/api/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then(async (res) => {
        console.log(res);
        const deckUploaded = await res.data.displayDeck;
        await setDeck(deckUploaded);
        localStorage.setItem("newDeckId", res.data.newDeckId);

        closePopup();
      })
      .catch((err) => console.log(err));
  };

  return (
    <div className="bg-form">
      <form onSubmit={handleSubmit}>
        <div className="row">
          <label>Upload Image Grid:</label>
          <input
            type="file"
            multiple
            name="image"
            id="image"
            accept="image/*"
            onChange={onImageChange}
            required
          />
        </div>

        {/* <div className="row">
          <label>Upload Image Grid (back page):</label>
          <input
            type="file"
            multiple
            accept="image/*"
            name="backFile"
            onChange={onImageChange}
          />
        </div> */}

        <div className="row">
          <label>Number of Cards Across:</label>
          <input
            type="number"
            name="numAcross"
            value={inputs.numAcross || ""}
            onChange={handleChange}
          />
        </div>

        <div className="row">
          <label>Number of Cards Down:</label>
          <input
            type="number"
            name="numDown"
            value={inputs.numDown || ""}
            onChange={handleChange}
          />
        </div>

        <div className="row">
          <label>Numer of Cards In Deck:</label>
          <input
            type="number"
            name="numTotal"
            value={inputs.numTotal || ""}
            onChange={handleChange}
          />
        </div>

        <div className="checkbox-wrapper">
          <div>
            <input
              type="checkbox"
              className={isChecked ? "checked" : ""}
              checked={isChecked}
              onChange={() => setIsChecked((prev) => !prev)}
            />
            <span>Same back for all cards? </span>
          </div>
          <div>
            <input
              type="checkbox"
              className={isChecked2 ? "checked" : ""}
              checked={isChecked2}
              onChange={() => setIsChecked2((prev) => !prev)}
            />
            <span>Landscape </span>
          </div>
        </div>

        <div className="row">
          <SMARTButton
            type="submit"
            className="bg-createGameBtn"
            theme="secondary"
            size="large"
            variant="contained"
          >
            Create Game
          </SMARTButton>
        </div>
      </form>
    </div>
  );
};

export default ImageUploadForm;
