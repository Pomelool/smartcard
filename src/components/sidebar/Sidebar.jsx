import React from "react";
import "./Sidebar.css";
import profileIcon from "../icons/account_circle_FILL0_wght400_GRAD0_opsz48.png";
import settingsIcon from "../icons/settings_FILL0_wght400_GRAD0_opsz48.png";
import logoutIcon from "../icons/power_settings_new_FILL0_wght400_GRAD0_opsz48.png";
import arrowIcon from "../icons/arrow_forward_ios_FILL0_wght400_GRAD0_opsz48.png";
import $ from "jquery";

let open = true;

const hideSidebar = () => {  
  if (open) {
    $("#profile").slideToggle();
    $("#settings").slideToggle();
    $("#logout").slideToggle();
    setTimeout(() => {
      $("#close-arrow").css({
        animation: "rotation 1s forwards",
      });
      setTimeout(() => {
        $("#options").css({
          display: "none",
        });
      }, 1000);

      $(".navbar").css({
        animation: "closingColumns 1s forwards",
      });
      open = false;
    }, 300);
  } else {
    $("#close-arrow").css({
      animation: "rotationBackwards 1s forwards",
    });
    $("#options").css({
      display: "grid",
    });
    $(".navbar").css({
      animation: "closingColumnsBackwards 1s forwards",
    });
    open = true;

    setTimeout(() => {
      $("#profile").slideToggle();
      $("#settings").slideToggle();
      $("#logout").slideToggle();
    }, 800)
  }
}

function Sidebar() {
  return (
    <nav className="navbar">
      <div id="close-open" onClick={hideSidebar}>
        <img id="close-arrow" src={arrowIcon} alt="Close" />
      </div>
      <div id="options">
        <div id="profile" className="items">
          <img src={profileIcon} alt="Profile" />
          <p>Profile</p>
        </div>
        <div id="settings" className="items">
          <img src={settingsIcon} alt="Settings" />
          <p>Settings</p>
        </div>
        <div id="logout" className="items">
          <img src={logoutIcon} alt="Logout" />
          <p>Logout</p>
        </div>
      </div>
    </nav>
  );
}

export default Sidebar;
